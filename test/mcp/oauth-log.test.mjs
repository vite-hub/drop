import assert from "node:assert/strict"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { H3Event } from "h3"
// The package itself: vitest swaps `vite-hub/auth/mcp` for a stub (test/stubs.ts).
import { mcpOAuth } from "@vite-hub/auth/mcp"
import { afterAll, test } from "vite-plus/test"
import { authRequest } from "../../server/utils/logs.ts"
import { oauthLog } from "../../server/utils/oauth-log.ts"

const origin = "https://drop.example"
const resource = `${origin}/mcp`
const redirectUri = "http://127.0.0.1:8080/callback"
// evlog ≥2.31 redacts these keys, so a field named like this would arrive as a placeholder.
const REDACTED_KEY = /(?:password|passwd|secret|token)$/i

// evlog's Nitro plugin with Drop's options (test/logs/wide-events.test.mjs), draining each request's wide event here.
const { evlogOptions } = await import("../../scripts/logging.ts")
process.env.__EVLOG_CONFIG = JSON.stringify(evlogOptions({ version: "1.2.3", commit: "abc1234" }))
const { default: evlogPlugin } = await import("../../node_modules/evlog/dist/nitro/v3/plugin.mjs")
const listeners = new Map()
const app = {
  hooks: {
    hook(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
    },
    async callHook(name, ...args) {
      for (const listener of listeners.get(name) ?? []) await listener(...args)
    },
  },
}
process.env.NODE_ENV = "production"
await evlogPlugin(app)
process.env.NODE_ENV = "test"
const events = []
app.hooks.hook("evlog:drain", ({ event }) => {
  events.push(event)
})

const database = new DatabaseSync(":memory:")
const options = {
  database,
  baseURL: origin,
  secret: "test-secret-for-mcp-oauth-log-1234567890",
  emailAndPassword: { enabled: true },
  // Drop's mcpOAuth() options and the logging plugin (server/auth.ts).
  plugins: [
    ...mcpOAuth({
      resource,
      loginPage: "/oauth",
      provider: { codeExpiresIn: 30 * 60, enforcePerClientResources: false },
    }),
    oauthLog(),
  ],
}
await (await getMigrations(options)).runMigrations()
const auth = betterAuth(options)
afterAll(() => database.close())

/** One request to Better Auth inside Drop's auth request scope (server/middleware/0.01.auth-request.ts): its response and wide event. */
async function call(path, { body, form, cookie, headers, method = body || form ? "POST" : "GET" } = {}) {
  const init = () => ({
    method,
    headers: {
      origin,
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
  })
  const url = `${origin}/api/auth${path}`
  const event = new H3Event(new Request(url, init()))
  const requestId = randomUUID()
  event.context.requestId = requestId
  await app.hooks.callHook("request", event)
  const response = await authRequest.run(event, () => auth.handler(new Request(url, init())))
  await app.hooks.callHook("response", response.clone(), event)
  await new Promise((resolve) => setImmediate(resolve))
  const emitted = events.filter((logged) => logged.requestId === requestId)
  assert.equal(emitted.length, 1, "one wide event per request")
  // As the host's log prints it.
  return { response, event: JSON.parse(JSON.stringify(emitted[0])) }
}

const signUp = await call("/sign-up/email", {
  body: { name: "Agent owner", email: "owner@example.test", password: "local-oauth-log-test-password" },
})
const cookie = signUp.response.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ")
const userId = database.prepare("SELECT id FROM user").get().id

async function register(name, callback = redirectUri) {
  const { response, event } = await call("/oauth2/register", {
    body: {
      client_name: name,
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  })
  assert.equal(response.status, 201, await response.clone().text())
  const { client_id } = await response.json()
  return { client_id, callback, event }
}

/** The authorization code flow with PKCE, approved (or denied) by the signed-in person the first time: the code and its verifier. */
async function authorize(client_id, { callback = redirectUri, accept = true } = {}) {
  const verifier = randomBytes(32).toString("base64url")
  const query = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: callback,
    scope: "openid profile email offline_access",
    state: "log-test",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  })
  const authorized = await call(`/oauth2/authorize?${query}`, { cookie })
  const consentPage = new URL(authorized.response.headers.get("location"), origin)
  // Consent is asked once per client.
  if (consentPage.pathname !== "/oauth")
    return { code: consentPage.searchParams.get("code"), verifier, authorized: authorized.event }
  const consent = await call("/oauth2/consent", {
    cookie,
    body: { accept, oauth_query: consentPage.search.slice(1) },
  })
  assert.equal(consent.response.status, 200, await consent.response.clone().text())
  const redirect = new URL((await consent.response.json()).url)
  return {
    code: redirect.searchParams.get("code"),
    redirect,
    verifier,
    authorized: authorized.event,
    consent: consent.event,
  }
}

async function exchange(client_id) {
  const { code, verifier } = await authorize(client_id)
  const { response, event } = await call("/oauth2/token", {
    form: {
      client_id,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    },
  })
  assert.equal(response.status, 200, await response.clone().text())
  return { tokens: await response.json(), code, verifier, event }
}

const refresh = (client_id, refresh_token) =>
  call("/oauth2/token", { form: { client_id, grant_type: "refresh_token", refresh_token, resource } })

/** Every secret the tests handed to or got from the token endpoint, which no wide event may contain. */
const secrets = []
const tokenHash = (token) => createHash("sha256").update(token).digest("base64url").slice(0, 12)

const executor = await register("Executor")

test("each OAuth step logs its endpoint, client and outcome, and a code exchange its grant", async () => {
  assert.deepEqual(executor.event.oauth, { endpoint: "/oauth2/register", clientId: executor.client_id, status: 201 })
  const { authorized, consent } = await authorize(executor.client_id)
  assert.deepEqual(authorized.oauth, { endpoint: "/oauth2/authorize", clientId: executor.client_id, status: 302 })
  assert.deepEqual(consent.oauth, { endpoint: "/oauth2/consent", clientId: executor.client_id, status: 200 })

  const { event, tokens, code, verifier } = await exchange(executor.client_id)
  secrets.push(tokens.refresh_token, code, verifier)
  assert.deepEqual(event.oauth, {
    endpoint: "/oauth2/token",
    grantType: "authorization_code",
    clientId: executor.client_id,
    status: 200,
  })
})

test("an unknown refresh token logs not_found", async () => {
  const unknown = randomBytes(24).toString("base64url")
  secrets.push(unknown)
  const { response, event } = await refresh(executor.client_id, unknown)
  assert.equal(response.status, 400)
  assert.equal(event.oauth.refresh.reason, "not_found")
  assert.equal(event.oauth.refresh.tokenHash, tokenHash(unknown))
  assert.equal(event.oauth.grantType, "refresh_token")
  assert.equal(event.oauth.error, "invalid_grant")
  assert.equal(event.oauth.status, 400)
})

test("an aged refresh token logs expired", async () => {
  const { tokens } = await exchange(executor.client_id)
  secrets.push(tokens.refresh_token)
  database
    .prepare("UPDATE oauthRefreshToken SET expiresAt = ? WHERE token = ?")
    .run(Date.now() - 60_000, createHash("sha256").update(tokens.refresh_token).digest("base64url"))
  const { response, event } = await refresh(executor.client_id, tokens.refresh_token)
  assert.equal(response.status, 400)
  assert.deepEqual(event.oauth.refresh, {
    reason: "expired",
    userId,
    clientId: executor.client_id,
    tokenHash: tokenHash(tokens.refresh_token),
  })
})

test("another client's refresh token logs client_mismatch with the client it belongs to", async () => {
  const { tokens } = await exchange(executor.client_id)
  secrets.push(tokens.refresh_token)
  const other = await register("Other agent")
  const { response, event } = await refresh(other.client_id, tokens.refresh_token)
  assert.equal(response.status, 400)
  assert.equal(event.oauth.clientId, other.client_id)
  assert.equal(event.oauth.refresh.reason, "client_mismatch")
  assert.equal(event.oauth.refresh.clientId, executor.client_id)
})

test("a replayed rotated refresh token logs reused with its owner, though the provider deletes its family", async () => {
  const replayer = await register("Replayer")
  const { tokens } = await exchange(replayer.client_id)
  const rotated = await refresh(replayer.client_id, tokens.refresh_token)
  assert.equal(rotated.response.status, 200, await rotated.response.clone().text())
  assert.equal(rotated.event.oauth.refresh.reason, "ok")
  assert.equal(rotated.event.oauth.status, 200)
  secrets.push(tokens.refresh_token, (await rotated.response.json()).refresh_token)

  const { response, event } = await refresh(replayer.client_id, tokens.refresh_token)
  assert.equal(response.status, 400)
  assert.deepEqual(event.oauth.refresh, {
    reason: "reused",
    userId,
    clientId: replayer.client_id,
    tokenHash: tokenHash(tokens.refresh_token),
  })
  const left = database
    .prepare("SELECT count(*) AS n FROM oauthRefreshToken WHERE clientId = ?")
    .get(replayer.client_id)
  assert.equal(left.n, 0, "the provider deleted the token's family")
})

test("an unknown client logs invalid_client, not the token's client mismatch", async () => {
  const { tokens } = await exchange(executor.client_id)
  secrets.push(tokens.refresh_token)
  const { response, event } = await refresh("no-such-client", tokens.refresh_token)
  assert.equal(response.status, 400, await response.clone().text())
  assert.equal(event.oauth.error, "invalid_client")
  assert.equal(event.oauth.refresh.reason, "invalid_client")
  assert.equal(event.oauth.refresh.clientId, executor.client_id)
})

test("the loser of two concurrent renewals logs raced, not ok", async () => {
  const { tokens } = await exchange(executor.client_id)
  secrets.push(tokens.refresh_token)
  const both = await Promise.all([
    refresh(executor.client_id, tokens.refresh_token),
    refresh(executor.client_id, tokens.refresh_token),
  ])
  const statuses = both.map(({ response }) => response.status).sort()
  assert.deepEqual(statuses, [200, 400], "one renewal wins")
  const loser = both.find(({ response }) => response.status === 400).event
  const winner = both.find(({ response }) => response.status === 200)
  secrets.push((await winner.response.json()).refresh_token)
  assert.equal(winner.event.oauth.refresh.reason, "ok")
  assert.equal(loser.oauth.refresh.reason, "raced")
})

test("a malformed Basic client ID gets the provider's 401, not a 500 from logging", async () => {
  const basic = Buffer.from("%E0%A4%A:secret").toString("base64")
  const { response, event } = await call("/oauth2/token", {
    headers: { authorization: `Basic ${basic}` },
    form: { grant_type: "refresh_token", refresh_token: "whatever-refresh-value" },
  })
  secrets.push("whatever-refresh-value")
  assert.equal(response.status, 401, await response.clone().text())
  assert.equal(event.oauth.status, 401)
  assert.equal(event.oauth.error, "invalid_client")
  assert.equal(event.oauth.logFailure, undefined)
})

test("denying consent logs access_denied though the response is 200", async () => {
  const denied = await register("Denied agent")
  const { consent, redirect } = await authorize(denied.client_id, { accept: false })
  assert.equal(redirect.searchParams.get("error"), "access_denied")
  assert.deepEqual(consent.oauth, {
    endpoint: "/oauth2/consent",
    clientId: denied.client_id,
    status: 200,
    error: "access_denied",
  })
})

test("callback query values and provider error text stay out of the event", async () => {
  const callback =
    "http://127.0.0.1:8080/callback?install=per-install-key&error=access_denied&error_description=from-the-callback"
  secrets.push("per-install-key", "from-the-callback")
  const client = await register("Callback with query", callback)
  const { consent, code } = await authorize(client.client_id, { callback })
  assert.ok(code, "consent was accepted")
  assert.equal(consent.oauth.error, undefined, "the callback's own error isn't the provider's")
  const again = await authorize(client.client_id, { callback })
  assert.equal(again.consent, undefined, "consent is remembered, so authorize redirects to the callback")
  assert.ok(again.code)
  assert.equal(again.authorized.oauth.status, 302)
  assert.equal(again.authorized.oauth.error, undefined)
  assert.doesNotMatch(JSON.stringify(again.authorized), /from-the-callback/)

  const rejected = await call("/oauth2/register", {
    body: {
      client_name: "Web app on loopback",
      application_type: "web",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
    },
  })
  assert.equal(rejected.response.status, 400, await rejected.response.clone().text())
  assert.match(await rejected.response.text(), /per-install-key/, "the provider echoes the callback")
  assert.equal(rejected.event.oauth.error, "invalid_redirect_uri")
  assert.doesNotMatch(JSON.stringify(rejected.event), /per-install-key/)
})

test("a registration refused by an earlier hook still logs its outcome", async () => {
  const { response, event } = await call("/oauth2/register", {
    body: { client_name: "No callbacks", token_endpoint_auth_method: "none" },
  })
  assert.equal(response.status, 400)
  assert.deepEqual(event.oauth, { endpoint: "/oauth2/register", status: 400, error: "invalid_client_metadata" })
})

test("no logged key would be redacted, and no event carries a refresh token, code or verifier", () => {
  assert.ok(secrets.length >= 8)
  const keys = (value, path = []) =>
    value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => [[...path, key].join("."), ...keys(child, [...path, key])])
      : []
  assert.ok(events.filter((event) => event.oauth?.refresh).length >= 5)
  for (const event of events) {
    for (const key of keys(event.oauth)) assert.doesNotMatch(key.split(".").at(-1), REDACTED_KEY, key)
    const serialised = JSON.stringify(event)
    for (const secret of secrets) assert.ok(!serialised.includes(secret), `event of ${event.path} leaks a secret`)
  }
})
