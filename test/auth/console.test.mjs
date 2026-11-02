import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, queries, reset, sql, state } from "../cost/harness.mjs"

const { default: authorize } = await import("../../server/console-authorize.ts")
const { authAccessLines } = await import("../../server/utils/auth-console.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { default: writesMiddleware } = await import("../../server/middleware/0.06.same-origin-writes.ts")
const { default: consoleMiddleware } = await import("../../server/middleware/0.19.console-pages.ts")
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

test("DROP_ADMINS grants every section, even when the stored role is stale; removal takes effect immediately", async () => {
  assert.equal(await authorize({ request, user }), true)
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

const open = (path, { method = "GET", headers = { "sec-fetch-mode": "navigate" } } = {}) =>
  consoleMiddleware(new H3Event(new Request(`https://drop.example${path}`, { method, headers })))
const PAGES = ["/_vitehub", "/_vitehub/", "/_vitehub/auth", "/_vitehub/blob/files?prefix=a"]

test("only admins in the browser open the Console's pages; members and agents get a 404", async () => {
  state.who = { userId: user.id, role: "admin", actorKind: "browser" }
  for (const path of PAGES) assert.equal(await open(path), undefined)
  for (const who of [
    { userId: "member", role: "member", actorKind: "browser" },
    { userId: user.id, role: "admin", actorKind: "agent" },
  ]) {
    state.who = who
    for (const path of PAGES) await assert.rejects(open(path), { status: 404 })
    for (const path of PAGES) await assert.rejects(open(path, { method: "HEAD", headers: {} }), { status: 404 })
  }
})

test("a signed-out visit to a Console page signs in and comes back to it", async () => {
  state.who = null
  for (const headers of [{ "sec-fetch-mode": "navigate" }, { accept: "text/html,application/xhtml+xml" }]) {
    const response = await open("/_vitehub/auth?tab=sessions", { headers })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get("location"), "/signin?redirect=%2F_vitehub%2Fauth%3Ftab%3Dsessions")
  }
})

test("the Console's files and data requests, and ViteHub's other routes, reach ViteHub's own checks", async () => {
  for (const who of [null, { userId: "member", role: "member", actorKind: "browser" }]) {
    state.who = who
    assert.equal(await open("/_vitehub/rpc/__call", { method: "POST" }), undefined)
    assert.equal(await open("/_vitehub/assets/console.js", { headers: { "sec-fetch-mode": "no-cors" } }), undefined)
    assert.equal(await open("/_vitehub/schedules/run", { method: "POST", headers: {} }), undefined)
    assert.equal(await open("/api/_vitehub/console/status"), undefined)
    assert.equal(await open("/api/_vitehub/realtime/latest/abc"), undefined)
    assert.equal(await open("/_vitehubish"), undefined)
  }
  // A tool fetching a ViteHub route while signed out is not sent to sign in.
  state.who = null
  assert.equal(await open("/_vitehub/kv/dev", { headers: {} }), undefined)
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

// The Console reads every other account's role through `console.roles.read` in server/auth.ts, so opening it writes
// none of them; it never sweeps the user table.
test("opening the Console writes no other account's role", async () => {
  sql.exec(`INSERT INTO user (id, name, email, email_verified, role) VALUES
    ('promoted', 'Promoted', 'promoted@example.com', 1, 'member'),
    ('removed', 'Removed', 'removed@example.com', 1, 'admin')`)
  state.admins = `${user.email}, promoted@example.com`
  queries.length = 0
  assert.equal(await authorize({ request, user }), true)
  assert.deepEqual(
    sql
      .prepare("SELECT id, role FROM user WHERE id IN ('promoted', 'removed') ORDER BY id")
      .all()
      .map(({ id, role }) => [id, role]),
    [
      ["promoted", "member"],
      ["removed", "admin"],
    ],
  )
  assert.equal(
    queries.filter(({ query }) => query.startsWith("select") && query.includes('from "user"') && !query.includes("where"))
      .length,
    0,
  )
})
