// Local D1 fixtures exercise plan changes and owner billing through the real routes.
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const origin = process.env.DROP_QUOTA_TEST_ORIGIN || "http://localhost:3406"
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
const state = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
const file = readdirSync(state).find(name => name.endsWith(".sqlite") && name !== "metadata.sqlite")
assert.ok(file, "Apply the local D1 migrations first")
const db = new DatabaseSync(join(state, file))
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000")
let cookie = ""
const drops = []
const users = []
async function request(path, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { cookie, origin, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
async function signup() {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email: `quota-plan-${crypto.randomUUID()}@example.com`, password: `Quota-${crypto.randomUUID()}`, name: "Plan test" }) })
  const data = await response.json()
  assert.equal(response.status, 200, JSON.stringify(data))
  const id = data.user.id
  users.push(id)
  return { id, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }
}
try {
  const admin = await signup()
  const owner = await signup()
  // Only the test fixture changes the role directly; plan changes use the admin API.
  db.prepare("UPDATE user SET role='admin' WHERE id=?").run(admin.id)
  cookie = admin.cookie
  assert.equal((await request(`/api/members/${admin.id}`, "PATCH", { plan: "unlimited" })).status, 200)
  assert.equal((await request("/api/usage")).data.plan, "unlimited")
  assert.equal((await request("/api/usage")).data.writes.limit, null)
  cookie = owner.cookie
  const doc = await request("/api/drops", "POST", { filename: "doc.md", content: "# Owner" })
  assert.equal(doc.status, 200)
  drops.push(doc.data.id)
  const app = await request("/api/apps", "POST", { files: { "index.html": "<h1>Owner</h1>" } })
  assert.equal(app.status, 200)
  drops.push(app.data.id)
  const fiftyFiles = { "index.html": "<h1>Max</h1>", ...Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`${i}.txt`, ""])) }
  const maxApp = await request("/api/apps", "POST", { files: fiftyFiles })
  assert.equal(maxApp.status, 200, JSON.stringify(maxApp.data))
  assert.equal((await request(`/api/drops/${maxApp.data.id}`, "DELETE")).status, 200)
  const image = await request("/api/code", "POST", { code: "const quota = 1", format: "svg" })
  assert.equal(image.status, 200)
  const imageResponse = await fetch(image.data.url)
  assert.equal(imageResponse.status, 200)
  const imageBytes = (await imageResponse.arrayBuffer()).byteLength
  const used = (await request("/api/usage")).data
  db.prepare("INSERT INTO quota_reservations (id,owner_id,month,drops,bytes,writes,committed,created_at) VALUES (?,?,?,0,0,?,1,?)").run(crypto.randomUUID(), owner.id, used.month, 1000 - used.writes.used, Date.now())
  cookie = admin.cookie
  const denied = await request(`/api/drops/${doc.data.id}/versions`, "POST", { content: "# Admin edit" })
  assert.equal(denied.status, 402)
  assert.deepEqual(denied.data.quota, { unit: "writes", used: 1000, limit: 1000 })
  const files = { "index.html": "", ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${i}.txt`, ""])) }
  const appDenied = await request("/api/apps", "POST", { id: app.data.id, files })
  assert.equal(appDenied.status, 402)
  assert.equal(appDenied.data.quota.unit, "appFiles")
  assert.equal(appDenied.data.quota.limit, 50)
  assert.equal((await request("/api/usage")).data.writes.used, 0)
  assert.equal((await request(`/api/members/${owner.id}`, "PATCH", { plan: "pro" })).status, 200)
  const revision = await request(`/api/drops/${doc.data.id}/versions`, "POST", { content: "# Admin edit" })
  assert.equal(revision.status, 200)
  drops[0] = revision.data.id
  assert.equal((await request("/api/usage")).data.writes.used, 0)
  cookie = owner.cookie
  const pro = (await request("/api/usage")).data
  assert.equal(pro.plan, "pro")
  assert.equal(pro.drops.used, 2)
  assert.equal(pro.drops.limit, 100)
  assert.equal(pro.bytes.limit, 1024 * 1024 * 1024)
  assert.equal(pro.writes.used, 1001)
  assert.equal(pro.writes.limit, 10_000)
  assert.equal(pro.app.files, 200)
  assert.equal(pro.app.bytes, 4 * 1024 * 1024)
  let previous = null
  let fixtureId
  const insert = db.prepare("INSERT INTO drops (id,owner_id,kind,title,filename,size,version,supersedes_id,actor_kind,actor_name,created_at,updated_at) VALUES (?,?,'file','History fixture','fixture.txt',0,?,?,'browser','Fixture',0,0)")
  for (let i = 0; i < 300; i++) {
    fixtureId = crypto.randomUUID()
    insert.run(fixtureId, owner.id, i + 1, previous)
    previous = fixtureId
  }
  assert.equal((await request("/api/usage")).data.drops.used, 3)
  assert.equal((await request(`/api/drops/${fixtureId}`, "DELETE")).status, 200)
  assert.equal((await request("/api/usage")).data.drops.used, 2)
  db.prepare("UPDATE quota_blobs SET expires_at=0 WHERE owner_id=?").run(owner.id)
  const cleanup = await fetch(`${origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent("0 * * * *")}`)
  assert.equal(cleanup.status, 200)
  const afterCleanup = (await request("/api/usage")).data
  assert.equal(afterCleanup.bytes.used, pro.bytes.used - imageBytes)
  assert.equal(afterCleanup.writes.used, 1001)
  assert.equal((await fetch(image.data.url)).status, 404)
  console.log("Quota admin smoke passed: plan changes, exhausted monthly budget, owner app cap, admin attribution, 50-file app, full history deletion, retained image cleanup")
}
finally {
  for (const id of drops) await request(`/api/drops/${id}`, "DELETE")
  for (const id of users) db.prepare("DELETE FROM user WHERE id=?").run(id)
  db.close()
}
