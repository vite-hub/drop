import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
// The package itself: vitest swaps `vite-hub/auth/mcp` for a stub (test/stubs.ts).
import { mcpOAuth, verifyMcpRequest } from "@vite-hub/auth/mcp"
import { test } from "vite-plus/test"

const origin = "https://drop.example"
const resource = `${origin}/mcp`
const redirectUri = "http://127.0.0.1:8080/callback"
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))

/** Drop's /mcp check (server/utils/identity.ts `fromAccessToken`) on a request carrying this access token. */
const callMcp = (auth, token) =>
  verifyMcpRequest(new Request(resource, { method: "POST", headers: { authorization: `Bearer ${token}` } }), {
    auth,
    resource,
  })

test("an MCP token refreshed after the approving browser session expired still opens /mcp", async () => {
  const database = new DatabaseSync(":memory:")
  const options = {
    database,
    baseURL: origin,
    secret: "test-secret-for-mcp-oauth-refresh-1234567890",
    emailAndPassword: { enabled: true },
    // Drop's mcpOAuth() options (server/auth.ts).
    plugins: [
      ...mcpOAuth({
        resource,
        loginPage: "/oauth",
        provider: { codeExpiresIn: 30 * 60, enforcePerClientResources: false },
      }),
    ],
  }
  try {
    await (await getMigrations(options)).runMigrations()
    const auth = betterAuth(options)
    const call = async (path, { body, form, cookie, method = body || form ? "POST" : "GET" } = {}) =>
      auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method,
          headers: {
            origin,
            ...(cookie ? { cookie } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
            ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          },
          body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
        }),
      )

    const signUp = await call("/sign-up/email", {
      body: { name: "Agent owner", email: "owner@example.test", password: "local-refresh-test-password" },
    })
    assert.equal(signUp.status, 200, await signUp.clone().text())
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")

    // Executor registers itself as a public client, the way Drop's production client did.
    const registered = await call("/oauth2/register", {
      body: {
        client_name: "Executor",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    })
    assert.equal(registered.status, 201, await registered.clone().text())
    const { client_id } = await registered.json()

    // Authorization code with PKCE, approved on the consent page by the signed-in person.
    const verifier = randomBytes(32).toString("base64url")
    const authorize = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      state: "refresh-test",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource,
    })
    const consentRedirect = await call(`/oauth2/authorize?${authorize}`, { cookie })
    const consentPage = new URL(consentRedirect.headers.get("location"), origin)
    assert.equal(consentPage.pathname, "/oauth", "Authorization asks for consent first")
    const consent = await call("/oauth2/consent", {
      cookie,
      body: { accept: true, oauth_query: consentPage.search.slice(1) },
    })
    assert.equal(consent.status, 200, await consent.clone().text())
    const code = new URL((await consent.json()).url).searchParams.get("code")
    assert.ok(code)

    const token = async (form) => {
      const response = await call("/oauth2/token", { form: { client_id, ...form } })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const issued = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    })
    assert.ok(issued.refresh_token)
    const sessionId = database.prepare("SELECT id FROM session").get().id
    const refreshSessionId = () =>
      database.prepare("SELECT sessionId FROM oauthRefreshToken WHERE revoked IS NULL").get().sessionId
    assert.equal(claims(issued.access_token).sid, sessionId)
    assert.equal(refreshSessionId(), sessionId)
    const [firstError] = await callMcp(auth, issued.access_token)
    assert.equal(firstError, undefined)

    // Renewal preserves the approving session while it is alive.
    const live = await token({ grant_type: "refresh_token", refresh_token: issued.refresh_token, resource })
    assert.equal(claims(live.access_token).sid, sessionId)
    assert.equal(refreshSessionId(), sessionId)

    // A browser session lasts days; the refresh token a month. The approving session runs out first.
    database.prepare("UPDATE session SET expiresAt = ?").run(Date.now() - 60_000)
    const [staleError] = await callMcp(auth, issued.access_token)
    assert.equal(staleError, undefined, "An offline_access grant survives the browser session (drop#147)")

    // Executor renews the access, as it did on 2026-11-06, and calls /mcp with the new token.
    const renewed = await token({ grant_type: "refresh_token", refresh_token: live.refresh_token, resource })
    assert.equal(claims(renewed.access_token).sid, undefined, "A renewed access token drops the expired session")
    assert.equal(refreshSessionId(), null, "The rotated refresh token drops the expired session")
    const [renewedError, caller] = await callMcp(auth, renewed.access_token)
    assert.equal(renewedError, undefined, renewedError?.message)
    assert.equal(caller.clientName, "Executor")
    assert.equal(caller.user.email, "owner@example.test")

    // The renewed refresh token no longer names the dead session, so the next renewal works too.
    const again = await token({ grant_type: "refresh_token", refresh_token: renewed.refresh_token, resource })
    assert.equal(claims(again.access_token).sid, undefined)
    assert.equal(refreshSessionId(), null)
    const [againError] = await callMcp(auth, again.access_token)
    assert.equal(againError, undefined, againError?.message)
  } finally {
    database.close()
  }
})
