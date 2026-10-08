import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

const origin = process.env.DROP_TRUST_TEST_ORIGIN
const state = process.env.DROP_TRUST_TEST_STATE

// Run only against an isolated local dev/preview instance, with 0005 applied and approval enabled.
test("approval, reports, quarantine, legal pages and native OAuth work over HTTP", { skip: !origin || !state }, async () => {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  const directory = join(state, "v3/d1/miniflare-D1DatabaseObject")
  const filename = readdirSync(directory).find(name => name.endsWith(".sqlite") && name !== "metadata.sqlite")
  assert.ok(filename, "Apply local migrations first")
  const db = new DatabaseSync(join(directory, filename), { timeout: 5000 })
  const request = async (path, { cookie, body, method = body ? "POST" : "GET" } = {}) => {
    const response = await fetch(new URL(path, origin), { method, headers: { origin, accept: path.startsWith("/api/") ? "application/json" : "text/html", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch {}
    return { status: response.status, text, json, headers: response.headers }
  }
  const signup = async (name) => {
    const result = await request("/api/auth/sign-up/email", { body: { name, email: `${name}-${crypto.randomUUID()}@example.test`, password: "local-trust-test-password" } })
    assert.equal(result.status, 200, result.text)
    return { id: result.json.user.id, cookie: result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }
  }
  const owner = await signup("owner")
  const admin = await signup("admin")
  db.prepare("UPDATE user SET role='admin' WHERE id=?").run(admin.id)
  const marker = `private-${crypto.randomUUID()}`
  const created = await request("/api/drops", { cookie: owner.cookie, body: { filename: "review.html", content: `<h1>${marker}</h1>` } })
  assert.equal(created.status, 200, created.text)
  const id = created.json.id
  assert.equal((await request(`/api/drops/${id}`)).status, 404)
  const pending = await request(`/api/drops/${id}`, { method: "PATCH", cookie: owner.cookie, body: { visibility: "shared" } })
  assert.equal(pending.json.shareReview, "pending", pending.text)
  const waiting = await request(`/d/${id}`)
  assert.match(waiting.text, /Waiting for review/)
  assert.doesNotMatch(waiting.text, new RegExp(marker))
  assert.equal(waiting.headers.get("x-robots-tag"), "noindex, nofollow")
  const privateDetail = await request(`/api/drops/${id}`, { cookie: owner.cookie })
  assert.match(privateDetail.json.content, new RegExp(marker))
  const raw = new URL(privateDetail.json.url).pathname
  const blockedRaw = await request(raw)
  assert.equal(blockedRaw.status, 404)
  assert.match(blockedRaw.text, />Report<\/a>/)
  assert.equal(blockedRaw.headers.get("x-robots-tag"), "noindex, nofollow")
  const review = await request("/api/admin/review", { cookie: admin.cookie })
  assert.equal(review.status, 200, review.text)
  assert.ok(review.json.some(member => member.id === owner.id && member.drops === 1))
  assert.equal((await request(`/api/admin/review/${owner.id}`, { cookie: admin.cookie, body: { action: "reject" } })).status, 200)
  assert.equal((await request(`/api/drops/${id}`, { cookie: owner.cookie })).json.shareReview, "rejected")
  await request(`/api/drops/${id}`, { method: "PATCH", cookie: owner.cookie, body: { visibility: "shared" } })
  assert.equal((await request(`/api/admin/review/${owner.id}`, { cookie: admin.cookie, body: { action: "approve" } })).status, 200)
  assert.equal((await request(`/api/drops/${id}`)).status, 200)
  const landing = await request(raw)
  assert.equal(landing.status, 200)
  assert.ok(landing.text.indexOf(">Report</a>") < landing.text.indexOf("<iframe"))
  const version = await request(`/api/drops/${id}/versions`, { cookie: owner.cookie, body: { content: `<h1>${marker} v2</h1>` } })
  assert.equal(version.status, 200, version.text)
  assert.equal(version.json.shareReview, null)
  const nextId = version.json.id
  const nextDetail = await request(`/api/drops/${nextId}`)
  const nextRaw = new URL(nextDetail.json.url).pathname
  const reported = await request("/api/reports", { body: { target: `/d/${id}`, reason: "phishing", details: "Local test report" } })
  assert.equal(reported.status, 200, reported.text)
  assert.equal((await request("/api/admin/reports")).status, 401)
  const reports = await request("/api/admin/reports", { cookie: admin.cookie })
  const report = reports.json.find(report => report.target === `/d/${id}`)
  assert.ok(report)
  assert.equal((await request(`/api/admin/reports/${report.id}`, { cookie: admin.cookie, body: { action: "quarantine" } })).status, 200)
  for (const path of [raw, nextRaw, `/api/drops/${id}`, `/api/drops/${nextId}`, `/api/drops/${id}/comments`]) assert.equal((await request(path)).status, 404, path)
  assert.equal((await request(`/api/drops/${nextId}`, { cookie: owner.cookie })).status, 404)
  await request(`/api/admin/reports/${report.id}`, { cookie: admin.cookie, body: { action: "dismiss" } })
  assert.equal((await request(raw)).status, 404, "Dismiss cannot reverse quarantine")
  assert.equal((await request(`/api/admin/reports/${report.id}`, { cookie: admin.cookie, body: { action: "ban" } })).status, 200)
  assert.equal(db.prepare("SELECT banned FROM user WHERE id=?").get(owner.id).banned, 1)
  for (const path of ["/terms", "/acceptable-use", "/abuse", "/report"]) assert.equal((await request(path)).status, 200, path)
  const robots = await request("/robots.txt")
  assert.match(robots.text, /Disallow: \/f\//)
  assert.match(robots.text, /Disallow: \/d\//)
  assert.doesNotMatch(robots.text, /Disallow: \/docs/)
  for (const redirect of ["http://localhost:1455/callback", "http://127.0.0.1:1456/callback", "com.cursor:/callback", "com.microsoft.vscode:/callback"]) {
    const result = await request("/api/auth/oauth2/register", { body: { client_name: "MCP trust test", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } })
    assert.equal(result.status, 201, result.text)
    assert.equal(result.json.application_type, "native")
  }
  assert.equal((await request("/api/auth/oauth2/register", { body: { redirect_uris: Array(6).fill("http://localhost/callback") } })).status, 400)
  assert.equal((await request("/api/auth/oauth2/register", { body: { redirect_uris: ["http://localhost/callback"], metadata: "x".repeat(20000) } })).status, 413)
  let limited = false
  for (let i = 0; i < 10; i++) {
    const before = db.prepare("SELECT count(*) AS n FROM oauth_client").get().n
    const result = await request("/api/auth/oauth2/register", { body: { client_name: "Burst test", redirect_uris: ["http://localhost:1455/callback"], token_endpoint_auth_method: "none" } })
    if (result.status === 429) {
      assert.equal(db.prepare("SELECT count(*) AS n FROM oauth_client").get().n, before, "Rate rejection happens before a database write")
      limited = true
      break
    }
    assert.equal(result.status, 201, result.text)
  }
  assert.ok(limited, "Registration must be rate limited by IP")
  const jsonError = await fetch(new URL("/f/missing.html", origin), { headers: { accept: "application/json" } })
  assert.equal(jsonError.headers.get("x-robots-tag"), "noindex, nofollow")
  db.close()
})
