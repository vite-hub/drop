import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

const origin = process.env.DROP_PROXY_TEST_ORIGIN
const database = process.env.DROP_PROXY_TEST_DATABASE
const githubToken = process.env.DROP_PROXY_TEST_TOKEN

// Use an isolated SQLite proxy-mode Node build, never a shared deployment or database.
test("proxy login preserves content restrictions, bans and MCP authorization", { skip: !origin || !database || !githubToken }, async () => {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  const db = new DatabaseSync(database)
  let cookie = ""
  const request = async (path, { body, method = body ? "POST" : "GET", proxy = false, anonymous = false, headers = {} } = {}) => {
    const response = await fetch(new URL(path, origin), {
      method, redirect: "manual",
      headers: { origin, ...(!anonymous && cookie ? { cookie } : {}), ...(proxy ? { "x-auth-request-access-token": githubToken } : {}),
        ...(body ? { "content-type": typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json" } : {}), ...headers },
      body: body ? typeof body === "string" ? body : JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch {}
    return { status: response.status, headers: response.headers, text, json }
  }
  let dropId
  try {
    assert.equal((await request("/api/drops", { anonymous: true })).status, 401)
    assert.equal((await request("/api/drops", { headers: { "x-auth-request-access-token": "invalid-token" } })).status, 403)
    assert.equal((await request("/api/auth/sign-in/social", { body: { provider: "github" } })).status, 404)
    const login = await request("/api/auth/get-session", { proxy: true })
    assert.equal(login.status, 200, login.text)
    const userId = login.json.user.id
    cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
    assert.ok(cookie)
    const sessions = db.prepare("SELECT count(*) AS n FROM session WHERE user_id=?").get(userId).n
    assert.equal((await request("/api/drops", { proxy: true })).status, 200)
    assert.equal(db.prepare("SELECT count(*) AS n FROM session WHERE user_id=?").get(userId).n, sessions, "Reuse the existing browser session")
    const created = await request("/api/drops", { proxy: true, body: { filename: "proxy-test.md", content: "# Private test" } })
    assert.equal(created.status, 200, created.text)
    dropId = created.json.id
    assert.equal((await request(`/api/drops/${dropId}`, { method: "PATCH", body: { visibility: "shared" }, proxy: true })).status, 200)
    assert.equal((await request(`/d/${dropId}`, { anonymous: true })).status, 401)
    assert.equal((await request(`/d/${dropId}`, { proxy: true })).status, 200)
    db.prepare("UPDATE user SET banned=1 WHERE id=?").run(userId)
    assert.equal((await request("/api/drops")).status, 401, "An existing session cannot bypass a ban")
    db.prepare("UPDATE user SET banned=0 WHERE id=?").run(userId)

    const redirect = "http://127.0.0.1:1455/callback"
    const registration = await request("/api/auth/oauth2/register", { anonymous: true, body: {
      client_name: "Proxy integration test", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    } })
    assert.equal(registration.status, 201, registration.text)
    const clientId = registration.json.client_id
    const verifier = crypto.randomUUID() + crypto.randomUUID()
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url")
    const authorize = await request(`/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "openid profile email offline_access", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}/mcp`, state: "proxy-test" })}`)
    assert.ok([200, 302].includes(authorize.status), authorize.text)
    const consent = await request("/api/auth/oauth2/consent", { proxy: true, body: { accept: true, oauth_query: new URL(authorize.headers.get("location") ?? authorize.json.url, origin).search.slice(1) } })
    assert.equal(consent.status, 200, consent.text)
    const code = new URL(consent.json.redirect_uri ?? consent.json.url).searchParams.get("code")
    const tokens = await request("/api/auth/oauth2/token", { anonymous: true, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier, resource: `${origin}/mcp` }).toString() })
    assert.equal(tokens.status, 200, tokens.text)
    const mcp = await request("/mcp", { anonymous: true, body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { authorization: `Bearer ${tokens.json.access_token}`, accept: "application/json, text/event-stream" } })
    assert.equal(mcp.status, 200, mcp.text)
    const refresh = await request("/api/auth/oauth2/token", { anonymous: true, body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.json.refresh_token }).toString() })
    assert.equal(refresh.status, 200, refresh.text)
    db.prepare("UPDATE account SET access_token=NULL WHERE user_id=?").run(userId)
    assert.equal((await request("/mcp", { anonymous: true, body: { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers: { authorization: `Bearer ${tokens.json.access_token}`, accept: "application/json, text/event-stream" } })).status, 401, "MCP also requires a valid membership credential")
  }
  finally {
    if (dropId) await request(`/api/drops/${dropId}`, { method: "DELETE", proxy: true })
    db.close()
  }
})
