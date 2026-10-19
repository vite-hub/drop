import assert from "node:assert/strict"
import { test } from "node:test"

const origin = process.env.DROP_PRIVATE_TEST_ORIGIN

// Local dev has email sign-in enabled. Exercise the real OAuth token, publish, and browser-session paths.
test("MCP-created private drops belong to the authorizing browser account", { skip: !origin }, async () => {
  const url = new URL(origin)
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) || (url.protocol === "https:" && url.hostname.endsWith(".ts.net") && url.port), "Use a local dev server or its Tailscale HTTPS proxy")
  async function request(path, { cookie, body, headers = {}, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(new URL(path, origin), {
      method, redirect: "manual",
      headers: { origin, accept: path.startsWith("/api/") ? "application/json" : "text/html", ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json" } : {}), ...headers },
      body: body ? typeof body === "string" ? body : JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch {}
    return { status: response.status, text, json, headers: response.headers }
  }
  async function signup(name) {
    const email = `${name}-${crypto.randomUUID()}@example.test`
    const result = await request("/api/auth/sign-up/email", { body: { name, email, password: "local-private-drop-test-password" } })
    assert.equal(result.status, 200, "Local account creation failed")
    return { id: result.json.user.id, email, cookie: result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }
  }
  const owner = await signup("owner")
  const visitor = await signup("visitor")
  const redirect = "http://127.0.0.1:1455/callback"
  const registration = await request("/api/auth/oauth2/register", { body: {
    client_name: "Private drop regression", redirect_uris: [redirect], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  } })
  assert.equal(registration.status, 201, registration.text)
  const clientId = registration.json.client_id
  const verifier = crypto.randomUUID() + crypto.randomUUID()
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url")
  const authorize = await request(`/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "openid profile email offline_access", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}/mcp`, state: "private-drop-test" })}`, { cookie: owner.cookie })
  assert.ok([200, 302].includes(authorize.status), "Local OAuth authorization failed")
  const consent = await request("/api/auth/oauth2/consent", { cookie: owner.cookie, body: { accept: true, oauth_query: new URL(authorize.headers.get("location") ?? authorize.json.url, origin).search.slice(1) } })
  assert.equal(consent.status, 200, "Local OAuth consent failed")
  const code = new URL(consent.json.redirect_uri ?? consent.json.url).searchParams.get("code")
  const tokens = await request("/api/auth/oauth2/token", { body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier, resource: `${origin}/mcp` }).toString() })
  assert.equal(tokens.status, 200, "Local OAuth token exchange failed")
  const auth = { authorization: `Bearer ${tokens.json.access_token}` }
  assert.equal((await request("/api/me", { headers: auth })).json.id, owner.id)

  const marker = `private-content-${crypto.randomUUID()}`
  const published = await request("/mcp", { headers: { ...auth, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" }, body: {
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "publish", arguments: { title: "Private regression", files: { "index.html": `<h1>${marker}</h1>` }, note: "Regression check", lifetime: "temporary" } },
  } })
  assert.equal(published.status, 200, "MCP publish failed")
  const result = published.json ?? JSON.parse(published.text.match(/^data: (.+)$/m)[1])
  assert.notEqual(result.result?.isError, true, "MCP publish returned an error")
  const id = result.result.content.map(block => block.text ?? "").join(" ").match(/id=([0-9a-f-]+)/)[1]
  const path = `/d/${id}`
  try {
    const own = await request(path, { cookie: owner.cookie })
    assert.equal(own.status, 200, own.text)
    assert.ok(own.text.includes(marker), "The authorizing browser account must see its MCP-created private content during SSR")
    const anonymous = await request(path)
    assert.equal(anonymous.status, 404)
    assert.match(anonymous.text, /Sign in with GitHub/)
    assert.doesNotMatch(anonymous.text, new RegExp(marker))
    const wrongAccount = await request(path, { cookie: visitor.cookie })
    assert.equal(wrongAccount.status, 404)
    assert.match(wrongAccount.text, new RegExp(visitor.email))
    assert.match(wrongAccount.text, /Use another account/)
    assert.doesNotMatch(wrongAccount.text, new RegExp(`${marker}|${owner.email}`))
    const missingId = crypto.randomUUID()
    const missing = await request(`/d/${missingId}`)
    assert.equal(missing.status, 404)
    assert.equal(anonymous.text.replaceAll(id, "id"), missing.text.replaceAll(missingId, "id"), "Private and missing drops disclose the same information")
    const signIn = await request(`/signin?redirect=${encodeURIComponent(path)}`, { cookie: visitor.cookie })
    assert.equal(signIn.status, 200)
    assert.equal(signIn.headers.get("cache-control"), "private, no-store")
    assert.match(signIn.text, new RegExp(visitor.email), "SSR recognizes the browser's account, including secure HTTPS cookies")
    assert.match(signIn.text, /Use another GitHub account/)
    assert.ok(signIn.text.includes(`href="${path}"`), "Continue keeps the original link")
    const github = await request("/api/auth/sign-in/social", { body: { provider: "github", callbackURL: path, additionalParams: { prompt: "select_account" } } })
    assert.equal(github.status, 200)
    assert.equal(new URL(github.json.url).searchParams.get("prompt"), "select_account")
    const shared = await request(`/api/drops/${id}`, { cookie: owner.cookie, method: "PATCH", body: { share: "public_comment" } })
    assert.equal(shared.status, 200)
    assert.equal((await request(path)).status, 200)
  }
  finally {
    await request(`/api/drops/${id}`, { cookie: owner.cookie, method: "DELETE" })
  }
})
