import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, sql, state } from "../cost/harness.mjs"

const { default: authorize } = await import("../../server/console-authorize.ts")
const { authAccessLines } = await import("../../server/utils/auth-console.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { default: writesMiddleware } = await import("../../server/middleware/0.06.same-origin-writes.ts")
const { H3Event } = await import("h3")
const user = { id: "operator", email: "operator@example.com", emailVerified: true, role: "member" }
const request = new Request("https://drop.example/_vitehub/rpc/__call")
/** Whether the Console answers like a Drop without one. */
const hidden = async (input) => (await authorize(input))?.status === 404

migrate()
beforeEach(() => {
  reset()
  Object.assign(state, { admins: user.email, members: "", githubOrg: "", contentOrigin: "" })
  sql
    .prepare("INSERT INTO user (id, name, email, email_verified, role) VALUES (?, 'Operator', ?, 1, 'member')")
    .run(user.id, user.email)
})

test("the Console is a 404 for signed-out, non-admin, unverified and banned users", async () => {
  for (const person of [
    undefined,
    { ...user, email: "member@example.com", role: "admin" },
    { ...user, emailVerified: false },
    { ...user, banned: true },
  ])
    assert.ok(await hidden({ request, user: person }))
})

test("DROP_ADMINS grants every section, even when the stored role is stale; removal takes effect immediately", async () => {
  assert.equal(await authorize({ request, user }), true)
  state.admins = "someone-else@example.com"
  assert.ok(await hidden({ request, user: { ...user, role: "admin" } }))
})

test("Console access still requires organization membership, including for a listed admin", async () => {
  state.githubOrg = "vite-hub"
  assert.ok(await hidden({ request, user }), "No GitHub organization grant")
})

test("bearer tokens and content-origin hosts cannot open the Console", async () => {
  assert.ok(await hidden({ request: new Request(request, { headers: { authorization: "Bearer agent" } }), user }))
  state.contentOrigin = "https://*-drop.vitehub.dev"
  for (const hostname of [`${"a".repeat(26)}-drop.vitehub.dev`, "stray-drop.vitehub.dev"])
    for (const path of ["/_vitehub/auth", "/_vitehub/rpc/__call", "/api/_vitehub/console/status"])
      for (const method of ["GET", "POST"]) {
        const request = new Request(`https://${hostname}${path}`, { method })
        assert.ok(await hidden({ request, user }))
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
