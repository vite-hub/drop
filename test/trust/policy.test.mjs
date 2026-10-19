import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { needsShareReview, reportTarget } from "../../shared/trust.ts"
import { registrationProblem } from "../../shared/oauth-registration.ts"

// The harness loads the production permission function with its storage stubbed (and the CSS imports pages use).
import { state } from "../cost/harness.mjs"
const { permissions } = await import("../../server/utils/drops.ts")
const { htmlLanding } = await import("../../shared/html-landing.ts")

test("approval is optional; admins and approved members bypass it", () => {
  assert.equal(needsShareReview(false), false)
  assert.equal(needsShareReview(true, { role: "member" }), true)
  for (const owner of [{ role: "admin" }, { shareApprovedAt: 1 }]) assert.equal(needsShareReview(true, owner), false)
  assert.equal(needsShareReview(true, { role: "admin", banned: true }), true)
})

test("pending and rejected public links reach nobody yet; quarantine denies content even to owners", () => {
  state.mode = "personal"
  const owner = { userId: "owner", role: "member" }
  const drop = { ownerId: "owner", share: "public_comment", shareReview: null, quarantinedAt: null }
  assert.equal(permissions(drop, null).comment, true)
  assert.equal(permissions(drop, null).edit, false)
  for (const shareReview of ["pending", "rejected"]) {
    assert.equal(permissions({ ...drop, shareReview }, null).view, false)
    assert.equal(permissions({ ...drop, shareReview }, null).comment, false)
    assert.equal(permissions({ ...drop, shareReview }, owner).view, true)
  }
  for (const who of [null, owner, { userId: "admin", role: "admin" }])
    assert.equal(permissions({ ...drop, quarantinedAt: 1 }, who).view, false)
})

test("Team can edit lets teammates edit in the browser, not guests or their agents", () => {
  state.mode = "team"
  const drop = { ownerId: "owner", share: "team_edit", shareReview: null, quarantinedAt: null }
  const person = { userId: "teammate", role: "member", actorKind: "browser" }
  assert.equal(permissions(drop, null).view, false)
  assert.equal(permissions(drop, null).comment, false)
  assert.equal(permissions(drop, person).edit, true)
  assert.equal(permissions(drop, { ...person, actorKind: "agent" }).view, true)
  assert.equal(permissions(drop, { ...person, actorKind: "agent" }).edit, false)
  assert.equal(permissions(drop, person).manage, false)
  assert.equal(permissions({ ...drop, share: "team" }, person).edit, false)
  assert.equal(permissions({ ...drop, share: "private" }, person).view, false)
  assert.equal(permissions({ ...drop, expired: true }, person).view, false)
  assert.equal(permissions(drop, { userId: "owner", role: "member", actorKind: "agent" }).edit, true)
})

test("OAuth bounds preserve desktop MCP redirects", () => {
  for (const redirect of [
    "http://localhost:1234/callback",
    "http://127.0.0.1:8765/callback",
    "com.cursor:/callback",
    "com.microsoft.vscode:/callback",
    "https://claude.ai/api/mcp/auth_callback",
  ])
    assert.equal(registrationProblem({ client_name: "MCP", redirect_uris: [redirect] }), null)
  assert.ok(registrationProblem({ redirect_uris: Array(6).fill("http://localhost/cb") }))
  assert.ok(registrationProblem({ redirect_uris: ["http://localhost"], client_name: "x".repeat(161) }))
  assert.ok(registrationProblem({ redirect_uris: ["http://localhost"], metadata: { text: "x".repeat(17000) } }))
})

test("report paths cannot navigate to another origin or use traversal", () => {
  assert.equal(reportTarget("/d/id"), "/d/id")
  assert.equal(reportTarget("/f/code-images/image.svg"), "/f/code-images/image.svg")
  assert.equal(reportTarget("/f/%41.svg"), reportTarget("/f/A.svg"))
  assert.equal(reportTarget("/f/code-images%2Fimage.svg"), reportTarget("/f/code-images/image.svg"))
  for (const target of ["//evil.test", "https://evil.test/d/id", "/f/../api/me", "/d/id?test=1"])
    assert.equal(reportTarget(target), null)
})

test("HTML report chrome is outside the frame and user markup is escaped", () => {
  const html = htmlLanding('<script>parent.document.body.innerHTML="bad"</script><a href="/">fake</a>', "/f/file.html")
  assert.ok(html.indexOf(">Report</a>") < html.indexOf("<iframe"))
  assert.match(html, /sandbox="allow-scripts/)
  assert.doesNotMatch(html, /allow-same-origin/)
  assert.doesNotMatch(html, /<script>/)
})

test("reports keep their own status check and outlive the drops they name", () => {
  const db = new DatabaseSync(":memory:")
  const migrations = new URL("../../server/databases/migrations/", import.meta.url)
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, migrations), "utf8"))
  db.exec("INSERT INTO abuse_reports(id,target,reason,details,created_at) VALUES ('r','/d/missing','spam','details',1)")
  assert.equal(db.prepare("SELECT status FROM abuse_reports").get().status, "open")
  assert.throws(() => db.exec("UPDATE abuse_reports SET status='invalid'"))
  assert.ok(
    db
      .prepare("PRAGMA table_info(drops)")
      .all()
      .some((column) => column.name === "quarantined_at"),
  )
  db.close()
})

test("the hourly cleanup removes only old clients with no authorization evidence", async () => {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy")
  const orm = await import("drizzle-orm")
  const { sqliteTable, text, integer } = await import("drizzle-orm/sqlite-core")
  const sqlDb = new DatabaseSync(":memory:")
  sqlDb.exec(
    "CREATE TABLE oauth_client(id text, client_id text, user_id text, created_at integer); CREATE TABLE oauth_consent(id text, client_id text); CREATE TABLE oauth_access_token(id text, client_id text); CREATE TABLE oauth_refresh_token(id text, client_id text)",
  )
  const table = (name) => sqliteTable(name, { id: text("id"), clientId: text("client_id") })
  const oauthClient = sqliteTable("oauth_client", {
    id: text("id"),
    clientId: text("client_id"),
    userId: text("user_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
  })
  const tables = {
    oauthClient,
    oauthConsent: table("oauth_consent"),
    oauthAccessToken: table("oauth_access_token"),
    oauthRefreshToken: table("oauth_refresh_token"),
  }
  const db = drizzle(async (query, params, method) => {
    const statement = sqlDb.prepare(query)
    if (method === "run") {
      statement.run(...params)
      return { rows: [] }
    }
    return { rows: statement.all(...params).map((row) => Object.values(row)) }
  })
  const now = new Date()
  const old = now.getTime() - 25 * 60 * 60 * 1000
  for (const id of ["unused", "consented", "token", "refresh", "owned", "recent"])
    sqlDb
      .prepare("INSERT INTO oauth_client VALUES(?,?,?,?)")
      .run(id, id, id === "owned" ? "owner" : null, id === "recent" ? now.getTime() : old)
  for (const [name, id] of [
    ["oauth_consent", "consented"],
    ["oauth_access_token", "token"],
    ["oauth_refresh_token", "refresh"],
  ])
    sqlDb.prepare(`INSERT INTO ${name} VALUES(?,?)`).run(id, id)
  const source = readFileSync(new URL("../../server/utils/oauth-cleanup.ts", import.meta.url), "utf8")
  const implementation = source
    .slice(source.indexOf("export async function"))
    .replace("export ", "")
    .replace("now: Date", "now")
  const keys = ["db", ...Object.keys(tables), "and", "eq", "lt", "notExists"]
  const load = new Function(...keys, implementation + "; return cleanupUnusedOAuthClients")
  const cleanup = load(db, ...Object.values(tables), orm.and, orm.eq, orm.lt, orm.notExists)
  await cleanup(now)
  assert.deepEqual(
    sqlDb
      .prepare("SELECT id FROM oauth_client ORDER BY id")
      .all()
      .map((row) => row.id),
    ["consented", "recent", "refresh", "token"],
  )
  sqlDb.close()
})

test("publishing burst protection counts by owner across calls", async () => {
  const { H3Event } = await import("h3")
  const { requirePublishBurst } = await import("../../server/utils/publish-burst.ts")
  const owner = crypto.randomUUID()
  const request = () => new H3Event(new Request("https://drop.example/mcp", { method: "POST" }))
  // The harness stands in for ViteHub's limiter: it records the bucket and fails when told to.
  await requirePublishBurst(request(), owner)
  assert.equal(state.bursts.at(-1).key, owner)
  state.failBurst = true
  await assert.rejects(requirePublishBurst(request(), owner), (error) => error.status === 429)
  state.failBurst = false
})

test("raw file errors have report chrome and robots headers while API errors use Nitro", async () => {
  const { H3Event, HTTPError } = await import("h3")
  const { default: contentError } = await import("../../server/handlers/content-error.ts")
  const error = new HTTPError({ status: 404, statusText: "Not found" })
  const response = await contentError(error, new H3Event(new Request("https://drop.example/f/file.html")))
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  assert.match(await response.text(), />Report<\/a>/)
  assert.equal(await contentError(error, new H3Event(new Request("https://drop.example/api/drops/file"))), undefined)
})
