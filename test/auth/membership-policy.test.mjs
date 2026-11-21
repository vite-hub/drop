import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readdir } from "node:fs/promises"
import { requireCaller, withAnonymousAuthorization } from "@vite-hub/auth/server"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { H3 } from "h3"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { defineAuth } from "vite-hub/auth"
import { migrate, reset, sql, state } from "../cost/harness.mjs"
import { currentRoleAdapter } from "../../server/utils/current-role-adapter.ts"
import { roleFor } from "../../shared/roles.ts"

const { default: schema } = await import("../../server/databases/default/index.ts")
// Load the installed policy itself, rather than the application test stub for checkAuthMember.
const dist = new URL("../../node_modules/@vite-hub/auth/dist/", import.meta.url)
const file = (await readdir(dist)).find((name) => /^members-.*\.js$/.test(name))
const { n: createMembersGate, c: createAccessPolicyPlugin } = await import(/* @vite-ignore */ new URL(file, dist).href)

import { rethrowMembershipOutage } from "../../server/utils/members.ts"
import contentError from "../../server/handlers/content-error.ts"

migrate()
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  reset()
  sql.exec(`INSERT INTO user (id, name, email, email_verified, role) VALUES
    ('promoted', 'Promoted', 'promoted@example.com', 1, 'member'),
    ('removed', 'Removed', 'removed@example.com', 1, 'admin')`)
})

function auth(members = [{ kind: "email", email: "listed@example.com" }]) {
  const plugins = [admin({ defaultRole: "member" })]
  const gate = createMembersGate(members, [], plugins)
  const instance = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: currentRoleAdapter(drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }), (person) =>
      roleFor(person, "promoted@example.com", false),
    ),
    plugins: [...plugins, createAccessPolicyPlugin({ members: gate, policy: { recheck: "0s", allow: () => true } })],
  })
  return { instance, gate }
}

test("real membership gate uses current roles before session creation and sessionless admission", async () => {
  const { instance, gate } = auth()
  const context = await instance.$context
  const promoted = await context.internalAdapter.findUserById("promoted")
  const removed = await context.internalAdapter.findUserById("removed")
  assert.equal(promoted.role, "admin")
  assert.equal(removed.role, "member")
  assert.equal(await gate.allows(context, promoted), true)
  assert.equal(await gate.allows(context, removed), false)
  assert.ok(await context.internalAdapter.createSession("promoted"))
  await assert.rejects(
    context.internalAdapter.createSession("removed"),
    (error) => error.body.code === "AUTH_NOT_MEMBER",
  )
})

test("real session policy revokes an existing session after admin removal", async () => {
  const { instance } = auth()
  const context = await instance.$context
  // Insert a pre-existing session, bypassing admission as an earlier deployment would have done.
  const now = Date.now()
  sql
    .prepare(`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("old-session", "removed-token", "removed", now + 86_400_000, now, now)
  const session = await instance.api.getSession({ headers: new Headers({ cookie: cookie("removed-token") }) })
  assert.equal(session, null)
  assert.equal(sql.prepare("SELECT id FROM session WHERE id = ?").get("old-session"), undefined)
  const removed = await context.internalAdapter.findUserById("removed")
  assert.equal(removed.role, "member")
})

function cookie(token) {
  const signature = createHmac("sha256", "test-only-secret-at-least-thirty-two-characters")
    .update(token)
    .digest("base64")
  return `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}

function githubOutage() {
  const { instance } = auth([{ kind: "github-org", org: "acme" }])
  sql
    .prepare(`INSERT INTO account (id, user_id, provider_id, account_id, access_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("github", "removed", "github", "42", "outage-token", Date.now(), Date.now())
  const now = Date.now()
  sql
    .prepare(`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("outage-session", "outage-token", "removed", now + 86_400_000, now, now)
  vi.stubGlobal("fetch", async () => Response.json({}, { status: 502 }))
  return defineAuth(() => instance.options)
}

test("GitHub outages wrapped by the real caller translate to a retryable 503", async () => {
  const definition = githubOutage()
  const request = new Request("https://drop.example/api/me", { headers: { cookie: cookie("outage-token") } })
  await assert.rejects(
    requireCaller(request, definition).catch((error) => {
      assert.equal(error.code, "AUTH_PROVIDER_OPERATION_FAILED")
      assert.equal(error.cause.body.code, "AUTH_GITHUB_UNAVAILABLE")
      rethrowMembershipOutage(error)
      return null
    }),
    (error) => error.status === 503 && error.data?.code === "AUTH_GITHUB_UNAVAILABLE",
  )
})

test("the generated Blob guard fails closed with a retryable 503 on GitHub outages", async () => {
  const definition = githubOutage()
  const authorize = vi.fn(() => true)
  const serve = vi.fn(() => new Response("file"))
  const app = new H3({ onError: contentError, silent: true }).get(
    "/f/**",
    withAnonymousAuthorization(authorize, serve, definition),
  )
  const response = await app.fetch(
    new Request("https://drop.example/f/image.png", { headers: { cookie: cookie("outage-token") } }),
  )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.match(await response.text(), /Try again in a moment/)
  assert.equal(authorize.mock.calls.length, 0)
  assert.equal(serve.mock.calls.length, 0)
})
