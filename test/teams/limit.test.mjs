import assert from "node:assert/strict"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, roundTrips, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/config.ts")
const { teamLimitAdapter } = await import("../../server/utils/team-limit-adapter.ts")
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

async function together(requests, expectedError) {
  let results
  await roundTrips(async () => {
    results = await Promise.all(requests.map((request) => request()))
  })
  for (const response of results.filter((response) => !response.ok)) {
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), expectedError)
  }
  return results.filter((response) => response.ok).length
}

async function setup() {
  const auth = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: teamLimitAdapter(drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema })),
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
  const post = (path, headers, body) =>
    auth.handler(
      new Request(`https://drop.example/api/auth/organization/${path}`, {
        method: "POST",
        headers: new Headers([...headers, ["content-type", "application/json"]]),
        body: JSON.stringify(body),
      }),
    )
  return { auth, post, signUp, owner, team, count }
}

test("invitations sent at once stop at the free limit", async () => {
  const { post, owner, team, count } = await setup()
  const sent = await together(
    ["a", "b", "c", "d", "e"].map(
      (name) => () =>
        post("invite-member", owner.headers, {
          email: `${name}@team.example`,
          role: "member",
          organizationId: team.id,
        }),
    ),
    { code: "INVITATION_LIMIT_REACHED", message: "Invitation limit reached" },
  )
  const retry = await post("invite-member", owner.headers, {
    email: "retry@team.example",
    role: "member",
    organizationId: team.id,
  })
  assert.equal(retry.status, 403)
  assert.deepEqual(await retry.json(), { code: "INVITATION_LIMIT_REACHED", message: "Invitation limit reached" })
  // The owner and two pending invitations fill the three free seats.
  assert.equal(sent, 2)
  assert.equal(count("invitation", "AND status = 'pending'"), 2)
})

test("invitations accepted at once stop at the free limit", async () => {
  const { post, signUp, team, count } = await setup()
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
    invitees.map((invitee) => () => post("accept-invitation", invitee.headers, { invitationId: invitee.invitationId })),
    { code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", message: "Organization membership limit reached" },
  )
  const pending = sql.prepare("SELECT id, email FROM invitation WHERE status = 'pending' LIMIT 1").get()
  const invitee = invitees.find((invitee) => invitee.invitationId === pending.id)
  const retry = await post("accept-invitation", invitee.headers, { invitationId: pending.id })
  assert.equal(retry.status, 403)
  assert.deepEqual(await retry.json(), {
    code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
    message: "Organization membership limit reached",
  })
  assert.equal(accepted, 2)
  assert.equal(count("member"), 3)
  // A refused acceptance leaves its invitation pending, for when a seat frees up.
  assert.equal(count("invitation", "AND status = 'pending'"), 2)
})

test("a team that pays has no limit, in the database too", async () => {
  const { post, owner, team } = await setup()
  sql
    .prepare("INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'team', ?, 'active')")
    .run(team.id)
  const sent = await together(
    ["a", "b", "c", "d", "e"].map(
      (name) => () =>
        post("invite-member", owner.headers, {
          email: `${name}@team.example`,
          role: "member",
          organizationId: team.id,
        }),
    ),
  )
  assert.equal(sent, 5)
  assert.equal(sql.prepare("SELECT member_limit FROM organization").get().member_limit, null)
})

test("members added at once get the same refusal as a retry", async () => {
  const { auth, signUp, team, count } = await setup()
  const people = []
  for (const name of ["a", "b", "c", "d"]) people.push(await signUp(name))
  const body = (person) => ({ userId: person.id, role: "member", organizationId: team.id })
  const added = await together(
    people.map((person) => () => auth.api.addMember({ body: body(person), asResponse: true })),
    { code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", message: "Organization membership limit reached" },
  )
  assert.equal(added, 2)
  assert.equal(count("member"), 3)
  const refused = people.find((person) => !sql.prepare("SELECT id FROM member WHERE user_id = ?").get(person.id))
  await assert.rejects(auth.api.addMember({ body: body(refused) }), (error) => {
    assert.equal(error.statusCode, 403)
    assert.deepEqual(error.body, {
      code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
      message: "Organization membership limit reached",
    })
    return true
  })
})

// Node SQLite only reports DROP_TEAM_FULL. D1 adds the primary and extended constraint codes to the cause message.
for (const prefix of ["", "D1_ERROR: "]) {
  for (const table of ["invitation", "member"]) {
    test(`D1 ${table} trigger refusals return 403 ${prefix ? "with" : "without"} the D1_ERROR prefix`, async () => {
      const { post, signUp, owner, team } = await setup()
      const invitee = await signUp("invitee")
      const invitationBody = { email: "invitee@team.example", role: "member", organizationId: team.id }
      let invitation
      if (table === "member") invitation = await (await post("invite-member", owner.headers, invitationBody)).json()
      sql.exec(
        `CREATE TRIGGER d1_limit_error BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, '${prefix}DROP_TEAM_FULL: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)'); END`,
      )
      try {
        const response =
          table === "invitation"
            ? await post("invite-member", owner.headers, invitationBody)
            : await post("accept-invitation", invitee.headers, { invitationId: invitation.id })
        assert.equal(response.status, 403)
        assert.deepEqual(
          await response.json(),
          table === "invitation"
            ? { code: "INVITATION_LIMIT_REACHED", message: "Invitation limit reached" }
            : { code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", message: "Organization membership limit reached" },
        )
        if (table === "member")
          assert.equal(sql.prepare("SELECT status FROM invitation WHERE id = ?").get(invitation.id).status, "pending")
      } finally {
        sql.exec("DROP TRIGGER d1_limit_error")
      }
    })
  }
}

test("other database errors still return a server error", async () => {
  const { post, owner, team } = await setup()
  sql.exec("CREATE TRIGGER fail_invitation BEFORE INSERT ON invitation BEGIN SELECT RAISE(ABORT, 'OTHER_FAILURE'); END")
  try {
    const response = await post("invite-member", owner.headers, {
      email: "DROP_TEAM_FULL@team.example",
      role: "member",
      organizationId: team.id,
    })
    assert.equal(response.status, 500)
  } finally {
    sql.exec("DROP TRIGGER fail_invitation")
  }
})
