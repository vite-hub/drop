import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { needsShareReview, reportTarget } from "../../shared/trust.ts"
import { registrationProblem } from "../../shared/oauth-registration.ts"
import { htmlLanding } from "../../shared/html-landing.ts"

// Exercise the production permission function without its storage/rendering dependencies.
const dropsSource = readFileSync(new URL("../../server/utils/drops.ts", import.meta.url), "utf8")
const permissionSource = dropsSource.match(/export function permissions\([\s\S]*?\n}\n/)[0]
  .replace(/: DropRow|: Identity \| null| as Access/g, "")
const { permissions } = await import(`data:text/javascript,${encodeURIComponent('const ACCESS_RANK={view:0,comment:1,edit:2};\n' + permissionSource)}`)

test("approval is optional; admins, unlimited plans and approved members bypass it", () => {
  assert.equal(needsShareReview(false), false)
  assert.equal(needsShareReview(true, { role: "member" }), true)
  for (const owner of [{ role: "admin" }, { plan: "unlimited" }, { shareApprovedAt: 1 }]) assert.equal(needsShareReview(true, owner), false)
  assert.equal(needsShareReview(true, { role: "admin", banned: true }), true)
})

test("pending and rejected shares stay private; quarantine denies content even to owners", () => {
  const owner = { userId: "owner", role: "member" }
  const drop = { ownerId: "owner", visibility: "shared", access: "edit", shareReview: null, quarantinedAt: null }
  assert.equal(permissions(drop, null).edit, true)
  for (const shareReview of ["pending", "rejected"]) {
    assert.equal(permissions({ ...drop, shareReview }, null).view, false)
    assert.equal(permissions({ ...drop, shareReview }, null).edit, false)
    assert.equal(permissions({ ...drop, shareReview }, owner).view, true)
  }
  for (const who of [null, owner, { userId: "admin", role: "admin" }]) assert.equal(permissions({ ...drop, quarantinedAt: 1 }, who).view, false)
})

test("OAuth bounds preserve desktop MCP redirects", () => {
  for (const redirect of ["http://localhost:1234/callback", "http://127.0.0.1:8765/callback", "com.cursor:/callback", "com.microsoft.vscode:/callback", "https://claude.ai/api/mcp/auth_callback"]) assert.equal(registrationProblem({ client_name: "MCP", redirect_uris: [redirect] }), null)
  assert.ok(registrationProblem({ redirect_uris: Array(6).fill("http://localhost/cb") }))
  assert.ok(registrationProblem({ redirect_uris: ["http://localhost"], client_name: "x".repeat(161) }))
  assert.ok(registrationProblem({ redirect_uris: ["http://localhost"], metadata: { text: "x".repeat(17000) } }))
})

test("report paths cannot navigate to another origin or use traversal", () => {
  assert.equal(reportTarget("/d/id"), "/d/id")
  assert.equal(reportTarget("/f/code-images/image.svg"), "/f/code-images/image.svg")
  assert.equal(reportTarget("/f/%41.svg"), reportTarget("/f/A.svg"))
  assert.equal(reportTarget("/f/code-images%2Fimage.svg"), reportTarget("/f/code-images/image.svg"))
  for (const target of ["//evil.test", "https://evil.test/d/id", "/f/../api/me", "/d/id?test=1"]) assert.equal(reportTarget(target), null)
})

test("HTML report chrome is outside the frame and user markup is escaped", () => {
  const html = htmlLanding('<script>parent.document.body.innerHTML="bad"</script><a href="/">fake</a>', "/f/file.html")
  assert.ok(html.indexOf('>Report</a>') < html.indexOf('<iframe'))
  assert.match(html, /sandbox="allow-scripts/)
  assert.doesNotMatch(html, /allow-same-origin/)
  assert.doesNotMatch(html, /<script>/)
})

test("0005 applies on the original schema and retains reports after deletion", () => {
  const db = new DatabaseSync(":memory:")
  for (const name of ["0000_init", "0001_security_constraints", "0002_oauth_provider", "0005_trust"]) db.exec(readFileSync(new URL(`../../server/databases/migrations/${name}.sql`, import.meta.url), "utf8"))
  db.exec("INSERT INTO abuse_reports(id,target,reason,details,created_at) VALUES ('r','/d/missing','spam','details',1)")
  assert.equal(db.prepare("SELECT status FROM abuse_reports").get().status, "open")
  assert.throws(() => db.exec("UPDATE abuse_reports SET status='invalid'"))
  assert.ok(db.prepare("PRAGMA table_info(drops)").all().some(column => column.name === "quarantined_at"))
  db.close()
})

test("the hourly cleanup removes only old clients with no authorization evidence", async () => {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy")
  const orm = await import("drizzle-orm")
  const { sqliteTable, text, integer } = await import("drizzle-orm/sqlite-core")
  const sqlDb = new DatabaseSync(":memory:")
  sqlDb.exec("CREATE TABLE oauth_client(id text, client_id text, user_id text, created_at integer); CREATE TABLE oauth_consent(id text, client_id text); CREATE TABLE oauth_access_token(id text, client_id text); CREATE TABLE oauth_refresh_token(id text, client_id text)")
  const table = name => sqliteTable(name, { id: text("id"), clientId: text("client_id") })
  const oauthClient = sqliteTable("oauth_client", { id: text("id"), clientId: text("client_id"), userId: text("user_id"), createdAt: integer("created_at", { mode: "timestamp_ms" }) })
  const tables = { oauthClient, oauthConsent: table("oauth_consent"), oauthAccessToken: table("oauth_access_token"), oauthRefreshToken: table("oauth_refresh_token") }
  const db = drizzle(async (query, params, method) => {
    const statement = sqlDb.prepare(query)
    if (method === "run") { statement.run(...params); return { rows: [] } }
    return { rows: statement.all(...params).map(row => Object.values(row)) }
  })
  const now = new Date()
  const old = now.getTime() - 25 * 60 * 60 * 1000
  for (const id of ["unused", "consented", "token", "refresh", "owned", "recent"]) sqlDb.prepare("INSERT INTO oauth_client VALUES(?,?,?,?)").run(id, id, id === "owned" ? "owner" : null, id === "recent" ? now.getTime() : old)
  for (const [name, id] of [["oauth_consent", "consented"], ["oauth_access_token", "token"], ["oauth_refresh_token", "refresh"]]) sqlDb.prepare(`INSERT INTO ${name} VALUES(?,?)`).run(id, id)
  const source = readFileSync(new URL("../../server/utils/oauth-cleanup.ts", import.meta.url), "utf8")
  const implementation = source.slice(source.indexOf("export async function")).replace("export ", "").replace("now: Date", "now")
  const keys = ["db", ...Object.keys(tables), "and", "eq", "lt", "notExists"]
  const cleanup = new Function(...keys, implementation + "; return cleanupUnusedOAuthClients")
    (db, ...Object.values(tables), orm.and, orm.eq, orm.lt, orm.notExists)
  await cleanup(now)
  assert.deepEqual(sqlDb.prepare("SELECT id FROM oauth_client ORDER BY id").all().map(row => row.id), ["consented", "recent", "refresh", "token"])
  sqlDb.close()
})

test("publishing burst protection counts by owner across calls", async () => {
  const { H3Event } = await import("h3")
  const { requirePublishBurst } = await import("../../server/utils/publish-burst.ts")
  const owner = crypto.randomUUID()
  const request = () => new H3Event(new Request("https://drop.example/mcp", { method: "POST" }))
  for (let i = 0; i < 30; i++) await requirePublishBurst(request(), owner)
  await assert.rejects(requirePublishBurst(request(), owner), error => error.status === 429)
  await requirePublishBurst(request(), crypto.randomUUID())
})

test("raw file errors have report chrome and robots headers while API errors use Nitro", async () => {
  const { H3Event, HTTPError } = await import("h3")
  const { default: contentError } = await import("../../server/handlers/content-error.ts")
  const error = new HTTPError({ status: 404, statusText: "Not found" })
  const response = contentError(error, new H3Event(new Request("https://drop.example/f/file.html")))
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  assert.match(await response.text(), />Report<\/a>/)
  assert.equal(contentError(error, new H3Event(new Request("https://drop.example/api/drops/file"))), undefined)
})
