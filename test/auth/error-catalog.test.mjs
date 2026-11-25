import assert from "node:assert/strict"
import { H3, H3Event, HTTPError } from "h3"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { authApiError, authError, authErrors } = await import("../../server/utils/auth-errors.ts")
const { requireAdmin, requireIdentity } = await import("../../server/utils/identity.ts")
const { requireSender } = await import("../../server/utils/comment-images.ts")
const { isMember, rethrowMembershipOutage } = await import("../../server/utils/members.ts")
const { isProxyMember } = await import("../../server/utils/proxy-auth-config.ts")
const { default: openReview } = await import("../../server/api/review/open.post.ts")

const unavailable = "GitHub membership verification is unavailable. Try again shortly."
// What each refusal answered before the catalog: clients and agents read these.
const before = {
  SIGN_IN_REQUIRED: [401, "Sign in, or connect your agent through Drop's MCP server."],
  ADMIN_REQUIRED: [403, "Only admins, in the browser, can do that."],
  SENDER_CHANGED: [401, "Sign in again to send this comment."],
  DOCUMENT_SIGN_IN_REQUIRED: [401, "Sign in to open the document."],
  REVIEW_SIGN_IN_REQUIRED: [401, "Sign in to open the review."],
  AUTH_GITHUB_UNAVAILABLE: [503, unavailable],
  GITHUB_REAUTH_REQUIRED: [401, "GitHub sign-in expired or was revoked. Sign in again to Drop."],
  GITHUB_ORG_ACCESS_REQUIRED: [
    403,
    "GitHub organization access could not be verified. Reauthorize Drop with read:org and any required organization SSO access.",
  ],
  GITHUB_MEMBERSHIP_UNAVAILABLE: [503, unavailable],
  GITHUB_MEMBERSHIP_REQUIRED: [403, "Active organization membership required."],
  GITHUB_IDENTITY_UNAVAILABLE: [503, "GitHub identity is unavailable. Try again shortly."],
  PROXY_SIGN_IN_FAILED: [403, "Proxy sign-in failed."],
}

function assertRefusal(error, code) {
  const [status, message] = before[code]
  assert.ok(HTTPError.isError(error), `${code} stays an h3 HTTPError`)
  assert.equal(error.status, status, code)
  assert.equal(error.statusText, message, code)
  assert.equal(error.message, message, code)
  assert.deepEqual(error.data, { code }, code)
  return true
}

migrate()
beforeEach(() => reset())
afterEach(() => {
  vi.unstubAllGlobals()
  Object.assign(state, { members: "", memberCheckError: undefined, authSecret: undefined })
  delete state.authApi
})

test("the catalog holds exactly the refusals Drop answered before, under the same codes", () => {
  assert.deepEqual(Object.keys(authErrors).sort(), Object.keys(before).sort())
  for (const [code, [status, message]] of Object.entries(before)) {
    assert.equal(authErrors[code].code, `auth.${code}`)
    assertRefusal(authError(code), code)
    assert.deepEqual(JSON.parse(JSON.stringify(authError(code))), {
      status,
      statusText: message,
      message,
      data: { code },
    })
    const api = authApiError(code)
    assert.equal(api.statusCode, status, code)
    assert.deepEqual({ ...api.body }, { message, code })
  }
})

test("identity checks refuse with their codes", async () => {
  const session = { current: null }
  state.authApi = { getSession: async () => ({ headers: new Headers(), response: session.current }) }
  const event = new H3Event(new Request("https://drop.example/api/drops"))
  await assert.rejects(requireIdentity(event), (error) => assertRefusal(error, "SIGN_IN_REQUIRED"))
  assert.equal(event.res.headers.get("www-authenticate"), 'Bearer realm="drop"')
  session.current = { user: { id: "owner", name: "Ada", email: "owner@example.com" }, session: {} }
  await assert.rejects(requireAdmin(new H3Event(new Request("https://drop.example/api/admin"))), (error) =>
    assertRefusal(error, "ADMIN_REQUIRED"),
  )
  assert.throws(
    () => requireSender({ userId: "owner" }, "someone-else"),
    (error) => assertRefusal(error, "SENDER_CHANGED"),
  )
})

test("opening a document or review signed out answers its code on the wire", async () => {
  // A review token is read before the session, and reading it needs the auth secret.
  state.authSecret = "test-only-secret-at-least-thirty-two-characters"
  const app = new H3().post("/api/review/open", openReview)
  for (const [body, code] of [
    [{ doc: "abc" }, "DOCUMENT_SIGN_IN_REQUIRED"],
    [{ token: "abc" }, "REVIEW_SIGN_IN_REQUIRED"],
  ]) {
    const response = await app.fetch(
      new Request("https://drop.example/api/review/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    const [status, message] = before[code]
    const json = await response.json()
    assert.equal(response.status, status, JSON.stringify(json))
    assert.equal(json.message, message)
    assert.deepEqual(json.data, { code })
  }
})

test("a GitHub membership outage refuses with AUTH_GITHUB_UNAVAILABLE", async () => {
  Object.assign(state, { members: "github-org:acme", memberCheckError: "AUTH_GITHUB_UNAVAILABLE" })
  await assert.rejects(isMember("owner"), (error) => assertRefusal(error, "AUTH_GITHUB_UNAVAILABLE"))
  assert.throws(
    () => rethrowMembershipOutage({ body: { code: "AUTH_GITHUB_UNAVAILABLE" } }),
    (error) => assertRefusal(error, "AUTH_GITHUB_UNAVAILABLE"),
  )
  assert.doesNotThrow(() => rethrowMembershipOutage(new Error("D1 is unavailable")))
})

test("the proxy's organization check refuses with its codes", async () => {
  state.members = "github-org:acme"
  for (const [token, upstream, code] of [
    ["test-catalog-401", () => Response.json({}, { status: 401 }), "GITHUB_REAUTH_REQUIRED"],
    [
      "test-catalog-403",
      () => Response.json({}, { status: 403, headers: { "x-oauth-scopes": "user:email" } }),
      "GITHUB_ORG_ACCESS_REQUIRED",
    ],
    ["test-catalog-502", () => Response.json({}, { status: 502 }), "GITHUB_MEMBERSHIP_UNAVAILABLE"],
  ]) {
    vi.stubGlobal("fetch", vi.fn(upstream))
    await assert.rejects(isProxyMember(token), (error) => assertRefusal(error, code))
  }
})
