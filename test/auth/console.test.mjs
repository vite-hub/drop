import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, sql, state } from "../cost/harness.mjs"

const { syncRole } = await import("../../server/utils/identity.ts")
const { default: authorize } = await import("../../server/console-authorize.ts")
const { authAccessLines } = await import("../../server/utils/auth-console.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { H3Event } = await import("h3")
const user = { id: "operator", email: "operator@example.com", emailVerified: true, role: "member" }
const request = new Request("https://drop.example/_vitehub/rpc", { method: "POST" })
/** A call signed by the ViteHub Console for `email`. */
const signed = (email) => ({ via: "console", request, key: "CONSOLE_TEST", user: { id: "console-user", email } })

migrate()
beforeEach(() => {
  reset()
  Object.assign(state, { admins: user.email, members: "", githubOrg: "", contentOrigin: "" })
  sql
    .prepare("INSERT INTO user (id, name, email, email_verified, role) VALUES (?, 'Operator', ?, 1, 'member')")
    .run(user.id, user.email)
})

test("a Console person listed in DROP_ADMINS gets every section; anyone else on the team gets none", async () => {
  assert.equal(await authorize(signed(user.email)), true)
  assert.equal(await authorize(signed("member@example.com")), false)
  assert.equal(await authorize(signed(undefined)), false)
  state.admins = "someone-else@example.com"
  assert.equal(await authorize(signed(user.email)), false)
})

test("the CLI key gets every section, and agents get none", async () => {
  assert.equal(await authorize({ via: "cli", request, key: "CI" }), true)
  assert.equal(await authorize({ via: "agent", request, user }), false)
})

test("the pill's Console link shows only to a verified, unbanned admin who is a member", async () => {
  const page = (person) => authorize({ via: "page", request, user: person })
  assert.equal(await page(user), true)
  for (const person of [
    undefined,
    { ...user, email: "member@example.com", role: "admin" },
    { ...user, emailVerified: false },
    { ...user, banned: true },
  ])
    assert.equal(await page(person), false)
  state.githubOrg = "vite-hub"
  assert.equal(await page(user), false, "No GitHub organization grant")
})

test("content-origin hosts never reach the Console", async () => {
  state.contentOrigin = "https://*-drop.vitehub.dev"
  for (const hostname of [`${"a".repeat(26)}-drop.vitehub.dev`, "stray-drop.vitehub.dev"])
    for (const path of ["/_vitehub/rpc", "/api/_vitehub/console/status"])
      for (const method of ["GET", "POST"]) {
        const request = new Request(`https://${hostname}${path}`, { method })
        assert.equal((await authorize({ ...signed(user.email), request })).status, 404)
        assert.equal((await contentMiddleware(new H3Event(request))).status, 404)
      }
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

test("Console resolves the app account by signed email before synchronizing its role", async () => {
  const calls = []
  state.syncRole = async (id) => {
    calls.push(id)
    await syncRole(id)
  }
  try {
    assert.equal(await authorize(signed(user.email)), true)
    assert.deepEqual(calls, [user.id])
    assert.equal(sql.prepare("SELECT role FROM user WHERE id = ?").get(user.id).role, "admin")
    assert.notEqual(user.id, signed(user.email).user.id)
  } finally {
    delete state.syncRole
  }
})
