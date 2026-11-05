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
  return { team, updates, remove, roles, ids, auth, headers: maker.headers, billing }
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

for (const method of ["retrieve", "update"])
  test(`a Stripe ${method} failure keeps the account's membership and ownership until a retry`, async () => {
    const { remove, roles, ids, billing } = await setup(
      [
        { name: "owner", role: "owner" },
        { name: "mate", role: "member" },
      ],
      { paying: true, status: "past_due" },
    )
    const original = billing.stripeClient.subscriptions[method]
    billing.stripeClient.subscriptions[method] = async () => {
      throw new Error("Stripe unavailable")
    }

    await assert.rejects(remove("owner"), /Stripe unavailable/)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id = ?").get(ids.owner).n, 1)
    assert.deepEqual(roles(), { owner: "owner", mate: "member" })
    assert.equal(sql.prepare("SELECT seats FROM subscription").get().seats, 2)

    billing.stripeClient.subscriptions[method] = original
    await remove("owner")
    assert.deepEqual(roles(), { mate: "owner" })
    assert.equal(sql.prepare("SELECT seats FROM subscription").get().seats, 1)
  })

for (const failure of ["read", "update", "response", "content", "commit"])
  test(`a later ${failure} failure restores live seats, preserves every team, and can be retried`, async () => {
    const { team, remove, roles, ids, auth, headers, billing, updates } = await setup(
      [
        { name: "owner", role: "owner" },
        { name: "mate", role: "member" },
      ],
      { paying: true, status: "past_due" },
    )
    const alone = await auth.api.createOrganization({ headers, body: { name: "Alone", slug: "alone" } })
    insertDrop("folder", { kind: "folder", blob_key: null, team_folder: 1, team_id: alone.id })
    insertDrop("doc", { parent_id: "folder" })
    const later = await auth.api.createOrganization({ headers, body: { name: "Later", slug: "later" } })
    await auth.api.addMember({ body: { userId: ids.mate, organizationId: later.id, role: "member" } })
    sql
      .prepare(
        "INSERT INTO subscription (id, plan, reference_id, stripe_customer_id, stripe_subscription_id, status, seats) VALUES ('s2', 'team', ?, 'cus_later', 'sub_later', 'past_due', 2)",
      )
      .run(later.id)
    const subscriptions = billing.stripeClient.subscriptions
    const retrieve = subscriptions.retrieve
    const first = structuredClone(await retrieve("sub_team"))
    const laterSubscription = structuredClone(first)
    laterSubscription.id = "sub_later"
    const live = new Map([
      [first.id, first],
      [laterSubscription.id, laterSubscription],
    ])
    let unavailable = true
    let reads = 0
    let writes = 0
    subscriptions.retrieve = async (id) => {
      if (unavailable && failure === "read" && ++reads === 2) throw new Error("Later Stripe read unavailable")
      return live.get(id)
    }
    subscriptions.update = async (id, params) => {
      // The second reduction can fail before or after Stripe applies it; restoration calls remain available.
      const fail = unavailable && params.items[0].quantity === 1 && ++writes === 2
      if (fail && failure === "update") throw new Error("Later Stripe update unavailable")
      updates.push({ id, ...params })
      const subscription = live.get(id)
      subscription.items.data[0].quantity = params.items[0].quantity
      if (fail && failure === "response") throw new Error("Later Stripe response unavailable")
      return subscription
    }
    if (failure === "content")
      sql.exec(`CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON drops
      BEGIN SELECT RAISE(ABORT, 'Team cleanup unavailable'); END`)
    if (failure === "commit")
      sql.exec(`CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON member
      WHEN OLD.organization_id IN (SELECT id FROM organization WHERE slug = 'later')
      BEGIN SELECT RAISE(ABORT, 'Team cleanup unavailable'); END`)
    const memberships = () => sql.prepare("SELECT * FROM member ORDER BY id").all()
    const before = memberships()

    try {
      await assert.rejects(remove("owner"), /unavailable/)
    } finally {
      sql.exec("DROP TRIGGER IF EXISTS fail_cleanup")
    }
    assert.deepEqual(memberships(), before)
    assert.deepEqual(roles(), { owner: "owner", mate: "member" })
    assert.equal(sql.prepare("SELECT count(*) AS n FROM organization").get().n, 3)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id = ?").get(ids.owner).n, 1)
    const seats = () =>
      sql
        .prepare("SELECT seats FROM subscription ORDER BY id")
        .all()
        .map((row) => row.seats)
    assert.deepEqual(seats(), [2, 2])
    if (failure !== "commit") {
      assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 2)
      assert.ok(objects.has("doc.md"))
    }
    assert.equal(first.items.data[0].quantity, 2)
    assert.equal(laterSubscription.items.data[0].quantity, 2)
    const expected = failure === "read" ? 0 : failure === "update" ? 2 : 4
    assert.equal(updates.length, expected)
    for (const id of live.keys()) {
      const changes = updates.filter((update) => update.id === id)
      if (!changes.length) continue
      assert.equal(changes[0].items[0].quantity, 1)
      assert.equal(changes.at(-1).items[0].quantity, 2)
      assert.equal(changes.at(-1).proration_date, changes[0].proration_date)
      assert.equal(changes.at(-1).proration_behavior, changes[0].proration_behavior)
    }

    unavailable = false
    await remove("owner")
    assert.deepEqual(roles(), { mate: "owner" })
    assert.equal(sql.prepare("SELECT role FROM member WHERE organization_id = ?").get(later.id).role, "owner")
    assert.equal(sql.prepare("SELECT count(*) AS n FROM organization WHERE id = ?").get(alone.id).n, 0)
    assert.deepEqual(seats(), [1, 1])
    assert.equal(first.items.data[0].quantity, 1)
    assert.equal(laterSubscription.items.data[0].quantity, 1)
    assert.equal(updates.length, expected + 2)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 0)
    assert.ok(!objects.has("doc.md"))
    assert.equal(sql.prepare("SELECT count(*) AS n FROM member WHERE organization_id = ?").get(team.id).n, 1)
  })

test("a lost Stripe response removes a newly added seat item without changing the original items", async () => {
  const { remove, roles, billing } = await setup(
    [
      { name: "owner", role: "owner" },
      { name: "mate", role: "member" },
    ],
    { paying: true, status: "past_due" },
  )
  const subscriptions = billing.stripeClient.subscriptions
  const live = await subscriptions.retrieve("sub_team")
  live.items.data[0].price.id = "price_other"
  const original = structuredClone(live.items.data)
  let unavailable = true
  subscriptions.update = async (id, params) => {
    const item = params.items[0]
    if (item.deleted) live.items.data = live.items.data.filter((entry) => entry.id !== item.id)
    else live.items.data.push({ id: "si_new", quantity: item.quantity, price: { id: item.price } })
    if (unavailable && !item.deleted) throw new Error("Stripe response unavailable")
    return live
  }

  await assert.rejects(remove("owner"), /Stripe response unavailable/)
  assert.deepEqual(live.items.data, original)
  assert.deepEqual(roles(), { owner: "owner", mate: "member" })
  assert.equal(sql.prepare("SELECT seats FROM subscription").get().seats, 2)

  unavailable = false
  await remove("owner")
  assert.deepEqual(live.items.data[0], original[0])
  assert.equal(live.items.data[1].quantity, 1)
  assert.deepEqual(roles(), { mate: "owner" })
  assert.equal(sql.prepare("SELECT seats FROM subscription").get().seats, 1)
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
