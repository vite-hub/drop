import assert from "node:assert/strict"
import { stripe } from "@better-auth/stripe"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, organization } from "better-auth/plugins"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, insertVersion, migrate, objects, reset, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/config.ts")
const { leaveTeams, teamPlans } = await import("../../server/utils/teams.ts")

// Deleting an account takes it off its teams, as server/auth.ts wires it: Stripe bills one seat less, and a team it owned
// passes on or goes.
migrate()
beforeEach(() => reset())

/** A Stripe client with one live subscription, `sub_team`, at `quantity` seats. It keeps the seat updates it gets. */
function stripeClient(quantity, updates, status) {
  const subscription = {
    id: "sub_team",
    status,
    items: { data: [{ id: "si_seat", quantity, price: { id: "price_month" } }] },
  }
  // The plugin awaits some lists and iterates others.
  const list = (data) =>
    Object.assign(Promise.resolve({ data }), {
      async *[Symbol.asyncIterator]() {
        yield* data
      },
    })
  return {
    customers: { search: async () => ({ data: [] }), list: () => list([]) },
    subscriptions: {
      list: () => list([subscription]),
      retrieve: async () => subscription,
      update: async (id, params) => {
        updates.push({ id, ...params })
        subscription.items.data[0].quantity = params.items[0].quantity
        return subscription
      },
    },
  }
}

async function setup(people, { paying = false, status = "active" } = {}) {
  const updates = []
  const billing = {
    stripeClient: stripeClient(people.length, updates, status),
    plans: teamPlans({ priceId: "price_month" }),
  }
  const auth = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
    emailAndPassword: { enabled: true },
    databaseHooks: { user: { delete: { before: (user, context) => leaveTeams(user, context, billing) } } },
    plugins: [
      admin(),
      organization({ creatorRole: "owner" }),
      stripe({
        stripeClient: billing.stripeClient,
        stripeWebhookSecret: "whsec_test",
        organization: { enabled: true },
        subscription: { enabled: true, plans: billing.plans },
      }),
    ],
  })
  const signUp = async (name) => {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email: `${name}@team.example`, password: "a-long-password", name },
      returnHeaders: true,
    })
    return { id: response.user.id, headers: new Headers({ cookie: headers.get("set-cookie").split(";")[0] }) }
  }
  const root = await signUp("root")
  sql.prepare("UPDATE user SET role = 'admin' WHERE id = ?").run(root.id)
  const [first, ...rest] = people
  // The first person makes the team; the rest join it in order, a millisecond apart.
  const maker = await signUp(first.name)
  const ids = { [first.name]: maker.id }
  const team = await auth.api.createOrganization({ headers: maker.headers, body: { name: "Acme", slug: "acme" } })
  for (const [index, person] of rest.entries()) {
    ids[person.name] = (await signUp(person.name)).id
    await auth.api.addMember({ body: { userId: ids[person.name], organizationId: team.id, role: person.role } })
    sql.prepare("UPDATE member SET created_at = created_at + ? WHERE user_id = ?").run(index + 1, ids[person.name])
  }
  if (paying) {
    sql.prepare("UPDATE organization SET stripe_customer_id = 'cus_team' WHERE id = ?").run(team.id)
    sql
      .prepare(
        "INSERT INTO subscription (id, plan, reference_id, stripe_customer_id, stripe_subscription_id, status, seats) VALUES ('s1', 'team', ?, 'cus_team', 'sub_team', ?, ?)",
      )
      .run(team.id, status, people.length)
  }
  const remove = (name) => auth.api.removeUser({ headers: root.headers, body: { userId: ids[name] } })
  const roles = () =>
    Object.fromEntries(
      sql
        .prepare("SELECT u.name, m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ?")
        .all(team.id)
        .map((row) => [row.name, row.role]),
    )
  return { team, updates, remove, roles, ids }
}

for (const status of ["active", "trialing", "past_due"])
  test(`a deleted member leaves a ${status} team, and Stripe bills one seat less`, async () => {
    const { remove, roles, updates } = await setup(
      [
        { name: "owner", role: "owner" },
        { name: "mate", role: "member" },
        { name: "pal", role: "member" },
      ],
      { paying: true, status },
    )
    await remove("mate")
    assert.deepEqual(roles(), { owner: "owner", pal: "member" })
    assert.deepEqual(
      updates.map((update) => update.items),
      [[{ id: "si_seat", quantity: 2 }]],
    )
    assert.equal(sql.prepare("SELECT seats FROM subscription").get().seats, 2)
  })

test("a deleted owner's team passes to its oldest admin, or to its oldest member when it has none", async () => {
  const withAdmins = await setup([
    { name: "owner", role: "owner" },
    { name: "mate", role: "member" },
    { name: "first", role: "admin" },
    { name: "second", role: "admin" },
  ])
  await withAdmins.remove("owner")
  assert.deepEqual(withAdmins.roles(), { mate: "member", first: "owner", second: "admin" })

  reset()
  const noAdmins = await setup([
    { name: "owner", role: "owner" },
    { name: "mate", role: "member" },
    { name: "pal", role: "member" },
  ])
  await noAdmins.remove("owner")
  assert.deepEqual(noAdmins.roles(), { mate: "owner", pal: "member" })
})

test("a team with nobody else on it goes with its owner, unless it still pays", async () => {
  const alone = await setup([{ name: "owner", role: "owner" }])
  await alone.remove("owner")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM organization").get().n, 0)

  reset()
  const paying = await setup([{ name: "owner", role: "owner" }], { paying: true })
  insertDrop("paying-folder", { kind: "folder", team_folder: 1, team_id: paying.team.id })
  insertDrop("paying-doc", { parent_id: "paying-folder" })
  await assert.rejects(paying.remove("owner"), /active subscription/i)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id = ?").get(paying.ids.owner).n, 1)
  assert.deepEqual(paying.roles(), { owner: "owner" })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 2)
  assert.ok(objects.has("paying-doc.md"))
})

test("a final team takes its folders, descendants, files and comments with it", async () => {
  const alone = await setup([{ name: "owner", role: "owner" }])
  insertDrop("folder", { kind: "folder", blob_key: null, team_folder: 1, team_id: alone.team.id })
  insertDrop("nested", { kind: "folder", blob_key: null, parent_id: "folder" })
  insertDrop("doc", { parent_id: "nested", version: 2 })
  insertVersion("doc", 1)
  insertDrop("other-folder", { kind: "folder", blob_key: null, team_folder: 1, team_id: alone.team.id })
  insertDrop("unrelated")
  const { default: comments } = await import("../../server/comments.ts")
  const [error] = await comments.create({
    subject: { kind: "drop", id: "doc" },
    body: "Team comment",
    author: { id: alone.ids.owner, name: "Owner" },
    revision: 1,
    metadata: { dropId: "doc" },
  })
  assert.ifError(error)

  await alone.remove("owner")

  assert.equal(sql.prepare("SELECT count(*) AS n FROM organization").get().n, 0)
  assert.deepEqual(
    sql
      .prepare("SELECT id FROM drops")
      .all()
      .map((row) => row.id),
    ["unrelated"],
  )
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_versions").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM vitehub_comment_threads").get().n, 0)
  assert.deepEqual([...objects.keys()], ["unrelated.md"])
})

test("a membership never outlives its account", () => {
  sql.prepare("INSERT INTO organization (id, name, slug) VALUES ('acme', 'Acme', 'acme')").run()
  sql.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'acme', 'owner', 'owner')").run()
  sql.prepare("DELETE FROM user WHERE id = 'owner'").run()
  assert.equal(sql.prepare("SELECT count(*) AS n FROM member").get().n, 0)
  assert.throws(() =>
    sql
      .prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES ('m2', 'acme', 'nobody', 'member')")
      .run(),
  )
})
