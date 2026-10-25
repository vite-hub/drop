import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, queries, reset, sql, state } from "../cost/harness.mjs"

const { default: authorize } = await import("../../server/console-authorize.ts")
const { authAccessLines } = await import("../../server/utils/auth-console.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { default: writesMiddleware } = await import("../../server/middleware/0.06.same-origin-writes.ts")
const { H3Event } = await import("h3")
const user = { id: "operator", email: "operator@example.com", emailVerified: true, role: "member" }
const request = new Request("https://drop.example/_vitehub/rpc/__call")

migrate()
beforeEach(() => {
  reset()
  Object.assign(state, { admins: user.email, members: "", githubOrg: "", contentOrigin: "" })
  sql
    .prepare("INSERT INTO user (id, name, email, email_verified, role) VALUES (?, 'Operator', ?, 1, 'member')")
    .run(user.id, user.email)
})

test("the Console denies signed-out, non-admin, unverified and banned users", async () => {
  for (const person of [
    undefined,
    { ...user, email: "member@example.com", role: "admin" },
    { ...user, emailVerified: false },
    { ...user, banned: true },
  ])
    assert.equal(await authorize({ request, user: person }), false)
})

test("DROP_ADMINS grants only Auth, even when the stored role is stale; removal takes effect immediately", async () => {
  assert.deepEqual(await authorize({ request, user }), { sections: ["auth"] })
  state.admins = "someone-else@example.com"
  assert.equal(await authorize({ request, user: { ...user, role: "admin" } }), false)
})

test("Console access still requires organization membership, including for a listed admin", async () => {
  state.githubOrg = "vite-hub"
  assert.equal(await authorize({ request, user }), false, "No GitHub organization grant")
})

test("bearer tokens and content-origin hosts cannot open the Console", async () => {
  assert.equal(
    await authorize({ request: new Request(request, { headers: { authorization: "Bearer agent" } }), user }),
    false,
  )
  state.contentOrigin = "https://*-drop.vitehub.dev"
  for (const hostname of [`${"a".repeat(26)}-drop.vitehub.dev`, "stray-drop.vitehub.dev"])
    for (const path of ["/_vitehub/auth", "/_vitehub/rpc/__call", "/api/_vitehub/console/status"])
      for (const method of ["GET", "POST"]) {
        const request = new Request(`https://${hostname}${path}`, { method })
        assert.equal(await authorize({ request, user }), false)
        assert.equal((await contentMiddleware(new H3Event(request))).status, 404)
      }
})

test("cookie-bearing Console writes reject a sibling origin", () => {
  const url = "https://drop.example/_vitehub/rpc/__call"
  assert.throws(
    () =>
      writesMiddleware(
        new H3Event(
          new Request(url, { method: "POST", headers: { cookie: "session=x", origin: "https://content.example" } }),
        ),
      ),
    { status: 403 },
  )
  assert.equal(
    writesMiddleware(
      new H3Event(
        new Request(url, { method: "POST", headers: { cookie: "session=x", origin: "https://drop.example" } }),
      ),
    ),
    undefined,
  )
})

test("access notes describe the configured allowlist, organization and sign-in methods", () => {
  const open = authAccessLines({ members: false, organization: "", proxied: false, password: false })
  assert.ok(open.includes("DROP_MEMBERS is off: there is no email allowlist."))
  assert.ok(open.includes("Sign-in uses GitHub."))
  const restricted = authAccessLines({ members: true, organization: "vite-hub", proxied: true, password: true }).join(
    "\n",
  )
  assert.match(restricted, /DROP_MEMBERS is on/)
  assert.match(restricted, /GitHub organization vite-hub/)
  assert.match(restricted, /oauth2-proxy/)
  assert.match(restricted, /Email and password/)
})

test("Console roles and Admins membership follow policy changes for accounts without new sessions", async () => {
  sql.exec(`INSERT INTO user (id, name, email, email_verified, role) VALUES
    ('promoted', 'Promoted', 'Promoted@example.com', 1, 'member'),
    ('removed', 'Removed', 'removed@example.com', 1, 'admin'),
    ('unverified', 'Unverified', 'unverified@example.com', 0, 'admin')`)
  state.admins = `${user.email}, PROMOTED@example.com unverified@example.com`
  assert.deepEqual(await authorize({ request, user }), { sections: ["auth"] })
  const rows = sql.prepare("SELECT id, role FROM user ORDER BY id").all()
  assert.deepEqual(
    rows.map(({ id, role }) => [id, role]),
    [
      ["operator", "admin"],
      ["owner", "member"],
      ["promoted", "admin"],
      ["removed", "member"],
      ["unverified", "member"],
    ],
  )
  assert.deepEqual(
    sql
      .prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id")
      .all()
      .map((row) => row.id),
    ["operator", "promoted"],
  )
  state.admins = `${user.email}, removed@example.com`
  await authorize({ request, user })
  assert.deepEqual(
    sql
      .prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id")
      .all()
      .map((row) => row.id),
    ["operator", "removed"],
  )
})

test("Console role sweeps are shared by concurrent requests and cached until policy changes", async () => {
  state.admins = `${user.email}, cache-test@example.com`
  queries.length = 0
  await Promise.all(Array.from({ length: 5 }, async () => authorize({ request, user })))
  const sweeps = () =>
    queries.filter(
      ({ query }) => query.startsWith("select") && query.includes('from "user"') && !query.includes("where"),
    )
  assert.equal(sweeps().length, 1)
  queries.length = 0
  await authorize({ request, user })
  assert.equal(sweeps().length, 0)
  state.admins = user.email
  await authorize({ request, user })
  assert.equal(sweeps().length, 1)
})
