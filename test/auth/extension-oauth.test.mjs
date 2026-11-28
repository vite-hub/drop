// Probe: can Drop's browser extension (Chrome MV3, Firefox 128+) sign in as a public OAuth client and get tokens for
// its own resource, `/api/review/notes`, that `/mcp` refuses and that an MCP token can't replace?
//
// Each step is one test, so the run reads as a pass/fail table. A failing step is a finding about the authorization
// server or the token checks, not a bug in this file. "today" is Drop's `mcpOAuth()` from server/auth.ts; "two
// resources" is the same call with `resource: [mcp, notes]`, the smallest change that lets the notes resource exist.
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
// The package itself: vitest swaps `vite-hub/auth/mcp` for a stub (test/stubs.ts).
import { mcpOAuth, verifyMcpRequest } from "@vite-hub/auth/mcp"
import { afterAll, test } from "vite-plus/test"

const origin = "https://drop.example.com"
const mcp = `${origin}/mcp`
const notes = `${origin}/api/review/notes`
const userinfo = `${origin}/api/auth/oauth2/userinfo`
const chromeRedirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
const firefoxRedirect = "https://0b1d2c3e-1111-4222-8333-444455556666.extensions.allizom.org/"
// What an extension's background fetch sends as Origin.
const chromeOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
const scope = "openid profile email offline_access"
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
const audiences = (token) => [claims(token).aud].flat()

async function setUp(resource) {
  const database = new DatabaseSync(":memory:")
  const options = {
    database,
    baseURL: origin,
    secret: "test-secret-for-extension-oauth-probe-1234567890",
    emailAndPassword: { enabled: true },
    plugins: [
      ...mcpOAuth({
        resource,
        loginPage: "/oauth",
        provider: { codeExpiresIn: 30 * 60, enforcePerClientResources: false },
      }),
    ],
  }
  await (await getMigrations(options)).runMigrations()
  const auth = betterAuth(options)
  const call = (path, { body, form, cookie, from = origin, method = body || form ? "POST" : "GET" } = {}) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method,
        headers: {
          origin: from,
          ...(cookie ? { cookie } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
      }),
    )
  const signUp = await call("/sign-up/email", {
    body: { name: "Reviewer", email: "reviewer@example.com", password: "local-extension-probe-password" },
  })
  assert.equal(signUp.status, 200, await signUp.clone().text())
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  return { auth, call, cookie, database }
}

/** RFC 7591 registration the way the extension would send it, from its own origin. */
async function registerExtension({ call }) {
  const response = await call("/oauth2/register", {
    from: chromeOrigin,
    body: {
      client_name: "Drop extension",
      redirect_uris: [chromeRedirect, firefoxRedirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  })
  return { status: response.status, body: await response.json() }
}

/** Authorization code + PKCE S256, consented by the signed-in person the way the existing auth tests do. */
async function authorize({ call, cookie }, clientId, { resource, redirectUri = chromeRedirect }) {
  const verifier = randomBytes(32).toString("base64url")
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: "extension-probe",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  })
  const started = await call(`/oauth2/authorize?${query}`, { cookie })
  const consentPage = new URL(started.headers.get("location"), origin)
  if (consentPage.searchParams.has("error"))
    return {
      error: consentPage.searchParams.get("error"),
      description: consentPage.searchParams.get("error_description"),
    }
  // A client the person already approved goes straight back to its redirect URI.
  if (`${consentPage.origin}${consentPage.pathname}` === redirectUri)
    return { back: consentPage, code: consentPage.searchParams.get("code"), verifier, redirectUri }
  assert.equal(consentPage.pathname, "/oauth", "Authorization asks for consent first")
  const consent = await call("/oauth2/consent", {
    cookie,
    body: { accept: true, oauth_query: consentPage.search.slice(1) },
  })
  assert.equal(consent.status, 200, await consent.clone().text())
  const back = new URL((await consent.json()).url)
  return { back, code: back.searchParams.get("code"), verifier, redirectUri }
}

const token = async ({ call }, form) => {
  const response = await call("/oauth2/token", { from: chromeOrigin, form })
  return { status: response.status, body: await response.json() }
}

const bearer = (url, accessToken) => ({ url, headers: new Headers({ authorization: `Bearer ${accessToken}` }) })

// `verifyAppAccessToken()` is internal to @vite-hub/auth, so it is read from its built chunk.
const dist = "node_modules/@vite-hub/auth/dist"
const chunk = readdirSync(dist).find((name) => /^mcp-token-[\w-]+\.js$/.test(name))
const { verifyAppAccessToken } = Object.values(await import(pathToFileURL(join(dist, chunk)).href)).find(
  (value) => typeof value?.verifyAppAccessToken === "function",
)

/**
 * Drop's real check on every route, `/mcp` included: server/utils/identity.ts → `requireCaller()` → `readCaller()`
 * (@vite-hub/auth dist/server-*.js) → `verifyAppAccessToken(token, origin, pathname, auth)`, which accepts a token
 * whose audience is any `mcpOAuth()` resource at the request origin, whatever the route.
 */
async function requireCallerAccepts(auth, url, accessToken) {
  const { origin, pathname } = new URL(url)
  const [error] = await verifyAppAccessToken(accessToken, origin, pathname, auth)
  return error ? error.data?.reason : "ok"
}

/** The check a notes route needs: the token's audience must name the notes resource, and only that resource counts. */
async function notesRouteAccepts(auth, accessToken) {
  const [error, caller] = await verifyMcpRequest(bearer(notes, accessToken), { auth, resource: notes })
  return error ? error.data?.reason : caller
}

/** What `/mcp` would accept with a strict check: the default resource of `verifyMcpRequest()` is the one at the path. */
async function strictMcpAccepts(auth, accessToken) {
  const [error] = await verifyMcpRequest(bearer(mcp, accessToken), { auth })
  return error ? error.data?.reason : "ok"
}

const today = await setUp(mcp)
const two = await setUp([mcp, notes])
afterAll(() => {
  today.database.close()
  two.database.close()
})
const state = {}

test("1. DCR registers the extension as a public client with Chrome's and Firefox's redirect URIs", async () => {
  const { status, body } = await registerExtension(today)
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.token_endpoint_auth_method, "none")
  assert.equal(body.client_secret, undefined, "A public client gets no secret")
  assert.deepEqual(body.redirect_uris, [chromeRedirect, firefoxRedirect])
  const second = await registerExtension(two)
  assert.equal(second.status, 201, JSON.stringify(second.body))
  state.client = second.body.client_id
})

// Drop's server/auth.ts has only /mcp today, so this runs on the two-resource setup, as Drop will be once it adds notes.
test("2a. two resources: authorize with resource=/api/review/notes", async () => {
  const result = await authorize(two, state.client, { resource: notes })
  assert.ok(result.code, `Refused: ${result.error}: ${result.description}`)
})

test("2b. two resources: authorize with resource=/api/review/notes, PKCE S256, offline_access", async () => {
  const result = await authorize(two, state.client, { resource: notes })
  assert.ok(result.code, `Refused: ${result.error}: ${result.description}`)
  assert.equal(`${result.back.origin}${result.back.pathname}`, chromeRedirect)
  assert.equal(result.back.searchParams.get("state"), "extension-probe")
  // Firefox's redirect, registered on the same client, works too.
  const firefox = await authorize(two, state.client, { resource: notes, redirectUri: firefoxRedirect })
  assert.ok(firefox.code, `Refused: ${firefox.error}: ${firefox.description}`)
  assert.equal(`${firefox.back.origin}${firefox.back.pathname}`, firefoxRedirect)
  state.grant = result
})

test("3a. the code exchange issues a notes-audience access token and a refresh token", async () => {
  const { code, verifier, redirectUri } = state.grant
  const issued = await token(two, {
    grant_type: "authorization_code",
    client_id: state.client,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: notes,
  })
  assert.equal(issued.status, 200, JSON.stringify(issued.body))
  // With openid in scope, Better Auth adds its userinfo endpoint to `aud`.
  assert.deepEqual(audiences(issued.body.access_token), [notes, userinfo])
  assert.equal(claims(issued.body.access_token).azp, state.client)
  assert.match(issued.body.scope, /offline_access/)
  assert.ok(issued.body.refresh_token, "offline_access gets a refresh token")
  state.notes = issued.body
})

test("3b. the refresh grant renews the notes token and keeps its audience", async () => {
  const renewed = await token(two, {
    grant_type: "refresh_token",
    client_id: state.client,
    refresh_token: state.notes.refresh_token,
    resource: notes,
  })
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body))
  assert.deepEqual(audiences(renewed.body.access_token), [notes, userinfo])
  assert.notEqual(renewed.body.refresh_token, state.notes.refresh_token, "The refresh token rotates")
  state.notes = renewed.body
})

test("3c. a notes refresh token can't be renewed into an /mcp token", async () => {
  const widened = await token(two, {
    grant_type: "refresh_token",
    client_id: state.client,
    refresh_token: state.notes.refresh_token,
    resource: mcp,
  })
  assert.equal(widened.status, 400)
  assert.equal(widened.body.error, "invalid_target")
})

test("4a. /mcp through Drop's identify() (requireCaller) refuses the notes token", async () => {
  assert.equal(await requireCallerAccepts(two.auth, mcp, state.notes.access_token), "wrong_resource")
})

test("4b. /mcp through verifyMcpRequest() at its own path refuses the notes token", async () => {
  assert.equal(await strictMcpAccepts(two.auth, state.notes.access_token), "wrong_resource")
})

test("4c. a notes route that requires aud=/api/review/notes accepts the notes token", async () => {
  const caller = await notesRouteAccepts(two.auth, state.notes.access_token)
  assert.equal(caller.clientName, "Drop extension")
  assert.equal(caller.user.email, "reviewer@example.com")
})

test("4d. a notes route that requires aud=/api/review/notes refuses an MCP token", async () => {
  const grant = await authorize(two, state.client, { resource: mcp })
  assert.ok(grant.code, `Refused: ${grant.error}: ${grant.description}`)
  const issued = await token(two, {
    grant_type: "authorization_code",
    client_id: state.client,
    code: grant.code,
    code_verifier: grant.verifier,
    redirect_uri: grant.redirectUri,
    resource: mcp,
  })
  assert.equal(issued.status, 200, JSON.stringify(issued.body))
  assert.deepEqual(audiences(issued.body.access_token), [mcp, userinfo])
  assert.equal(await strictMcpAccepts(two.auth, issued.body.access_token), "ok")
  assert.equal(await notesRouteAccepts(two.auth, issued.body.access_token), "wrong_resource")
  state.mcpToken = issued.body.access_token
})

test("4e. a notes route behind Drop's identify() (requireCaller) refuses an MCP token", async () => {
  assert.equal(await requireCallerAccepts(two.auth, notes, state.mcpToken), "wrong_resource")
})

test("5a. revoking the client the way DELETE /api/agents/<id> does makes the refresh fail", async () => {
  const { database } = two
  // GET /api/agents lists consents; the extension shows up there like any MCP client.
  const consent = database
    .prepare("SELECT id, clientId FROM oauthConsent WHERE clientId = ? AND userId = (SELECT id FROM user)")
    .get(state.client)
  assert.ok(consent, "The extension has a consent row, so Connected agents lists it")
  // server/api/agents/[id].delete.ts: refresh tokens, access tokens, then the consent, for this client and user.
  const userId = database.prepare("SELECT id FROM user").get().id
  for (const table of ["oauthRefreshToken", "oauthAccessToken"])
    database.prepare(`DELETE FROM ${table} WHERE clientId = ? AND userId = ?`).run(consent.clientId, userId)
  database.prepare("DELETE FROM oauthConsent WHERE id = ?").run(consent.id)

  const refreshed = await token(two, {
    grant_type: "refresh_token",
    client_id: state.client,
    refresh_token: state.notes.refresh_token,
    resource: notes,
  })
  assert.equal(refreshed.status, 400, JSON.stringify(refreshed.body))
  assert.equal(refreshed.body.error, "invalid_grant")
})

test("5b. after revoking, the notes access token already issued stops working", async () => {
  const left = Math.round(claims(state.notes.access_token).exp - Date.now() / 1000)
  const result = await notesRouteAccepts(two.auth, state.notes.access_token)
  assert.equal(typeof result, "string", `Still accepted, for ${left} s more until exp`)
})

test("5c. disabling the revoked client stops its issued access token", async () => {
  two.database.prepare("UPDATE oauthClient SET disabled = 1 WHERE clientId = ?").run(state.client)
  assert.equal(await notesRouteAccepts(two.auth, state.notes.access_token), "client_disabled")
})
