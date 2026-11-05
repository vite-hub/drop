import assert from "node:assert/strict"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, roundTrips, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/config.ts")
const { teamOptions } = await import("../../server/utils/teams.ts")

// A free team's limit (3 members here, test/stubs.ts) holds when requests arrive at once: Better Auth counts the team,
// then inserts in another query, so the database refuses the one past the limit. `together` runs requests the way D1
// does, each query a round trip that the others' queries share, so each request counts before any of them inserts.
migrate()
beforeEach(() => {
  reset()
  state.teams = true
  state.billing = true
})

async function together(requests) {
  let results
  await roundTrips(async () => {
    results = await Promise.allSettled(requests.map((request) => request()))
  })
  return results.filter((result) => result.status === "fulfilled").length
}

async function setup() {
  const auth = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
    emailAndPassword: { enabled: true },
    plugins: [organization(teamOptions)],
  })
  const signUp = async (name) => {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email: `${name}@team.example`, password: "a-long-password", name },
      returnHeaders: true,
    })
    return { id: response.user.id, headers: new Headers({ cookie: headers.get("set-cookie").split(";")[0] }) }
  }
  const owner = await signUp("owner")
  const team = await auth.api.createOrganization({ headers: owner.headers, body: { name: "Acme", slug: "acme" } })
  const count = (table, where = "") =>
    sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE organization_id = ? ${where}`).get(team.id).n
  return { auth, signUp, owner, team, count }
}

test("invitations sent at once stop at the free limit", async () => {
  const { auth, owner, team, count } = await setup()
  const sent = await together(
    ["a", "b", "c", "d", "e"].map(
      (name) => () =>
        auth.api.createInvitation({
          headers: owner.headers,
          body: { email: `${name}@team.example`, role: "member", organizationId: team.id },
        }),
    ),
  )
  // The owner and two pending invitations fill the three free seats.
  assert.equal(sent, 2)
  assert.equal(count("invitation", "AND status = 'pending'"), 2)
})

test("invitations accepted at once stop at the free limit", async () => {
  const { auth, signUp, team, count } = await setup()
  // Invitations from when the team paid: more than its free seats.
  const invitees = []
  for (const name of ["a", "b", "c", "d"]) {
    const invitee = await signUp(name)
    sql
      .prepare(
        "INSERT INTO invitation (id, organization_id, email, role, status, inviter_id, expires_at) VALUES (?, ?, ?, 'member', 'pending', 'owner', ?)",
      )
      .run(`inv-${name}`, team.id, `${name}@team.example`, Date.now() + 86_400_000)
    invitees.push({ ...invitee, invitationId: `inv-${name}` })
  }
  const accepted = await together(
    invitees.map(
      (invitee) => () =>
        auth.api.acceptInvitation({ headers: invitee.headers, body: { invitationId: invitee.invitationId } }),
    ),
  )
  assert.equal(accepted, 2)
  assert.equal(count("member"), 3)
  // A refused acceptance leaves its invitation pending, for when a seat frees up.
  assert.equal(count("invitation", "AND status = 'pending'"), 2)
})

test("a team that pays has no limit, in the database too", async () => {
  const { auth, owner, team } = await setup()
  sql
    .prepare("INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'team', ?, 'active')")
    .run(team.id)
  const sent = await together(
    ["a", "b", "c", "d", "e"].map(
      (name) => () =>
        auth.api.createInvitation({
          headers: owner.headers,
          body: { email: `${name}@team.example`, role: "member", organizationId: team.id },
        }),
    ),
  )
  assert.equal(sent, 5)
  assert.equal(sql.prepare("SELECT member_limit FROM organization").get().member_limit, null)
})
