// Run against local nuxt dev with DROP_QUOTAS=1, never a deployed instance.
import assert from "node:assert/strict"

const origin = process.env.DROP_QUOTA_TEST_ORIGIN || "http://localhost:3406"
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Quota smoke tests require a local instance")
let cookie = ""
async function request(path, method = "GET", body, headers = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { cookie, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers }, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined })
  const data = await response.json()
  return { response, data }
}
const email = `quota-${crypto.randomUUID()}@example.com`
const signin = await request("/api/auth/sign-up/email", "POST", { name: "Quota test", email, password: `Quota-test-${crypto.randomUUID()}` }, { origin })
assert.equal(signin.response.status, 200)
cookie = signin.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
assert.ok(cookie)
const usage = await request("/api/usage")
assert.equal(usage.data.enabled, true)
assert.equal(usage.data.plan, "free")
assert.equal(usage.data.drops.limit, 3)
const created = []
try {
  for (let i = 0; i < 2; i++) {
    const result = await request("/api/drops", "POST", { filename: "doc.md", content: `# Drop ${i}\n` })
    assert.equal(result.response.status, 200)
    created.push(result.data.id)
  }
  const app = await request("/api/apps", "POST", { files: { "index.html": "<h1>Quota</h1>", "style.css": "body{color:red}" } })
  assert.equal(app.response.status, 200)
  created.push(app.data.id)
  let currentUsage = (await request("/api/usage")).data
  assert.equal(currentUsage.drops.used, 3)
  assert.equal(currentUsage.writes.used, 4)
  const denied = await request("/api/drops", "POST", { filename: "fourth.md", content: "# Blocked" })
  assert.equal(denied.response.status, 402)
  assert.equal(denied.data.code, "DROP_LIMIT_REACHED")
  assert.deepEqual(denied.data.quota, { unit: "drops", used: 3, limit: 3 })
  assert.equal(denied.data.retryable, false)
  assert.equal(denied.data.upgradeUrl, "/settings/billing")
  const revision = await request(`/api/drops/${created[0]}/versions`, "POST", { content: "# Revised" })
  assert.equal(revision.response.status, 200)
  created[0] = revision.data.id
  const newApp = await request("/api/apps", "POST", { id: app.data.id, files: { "index.html": "<h1>New</h1>" } })
  assert.equal(newApp.response.status, 200)
  currentUsage = (await request("/api/usage")).data
  assert.equal(currentUsage.drops.used, 3)
  assert.equal(currentUsage.writes.used, 6)
  const shared = await request(`/api/drops/${created[0]}`, "PATCH", { visibility: "shared", access: "edit" })
  assert.equal(shared.response.status, 200)
  const ownerCookie = cookie
  cookie = ""
  const guestRevision = await request(`/api/drops/${created[0]}/versions`, "POST", { content: "# Guest revision" })
  cookie = ownerCookie
  assert.equal(guestRevision.response.status, 200)
  created[0] = guestRevision.data.id
  currentUsage = (await request("/api/usage")).data
  assert.equal(currentUsage.drops.used, 3)
  assert.equal(currentUsage.writes.used, 7)
  const expectedBytes = new TextEncoder().encode("# Drop 0\n# Drop 1\n# Revised# Guest revision<h1>New</h1>").byteLength
  assert.equal(currentUsage.bytes.used, expectedBytes)
  const oversizedApp = await request("/api/apps", "POST", { id: app.data.id, files: { "index.html": "", ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${i}.txt`, ""])) } })
  assert.equal(oversizedApp.response.status, 402)
  assert.equal(oversizedApp.data.quota.unit, "appFiles")
  assert.equal((await request("/api/usage")).data.writes.used, 7)
  const oversizedBytes = await request("/api/apps", "POST", { id: app.data.id, files: { "index.html": "x".repeat(2 * 1024 * 1024 + 1) } })
  assert.equal(oversizedBytes.response.status, 402)
  assert.equal(oversizedBytes.data.quota.unit, "appBytes")
  const form = new FormData()
  form.append("file", new File(["hello"], "upload.txt"))
  const fileDenied = await request("/api/files", "POST", form)
  assert.equal(fileDenied.response.status, 402)
  assert.equal(fileDenied.data.code, "DROP_LIMIT_REACHED")
  await request(`/api/drops/${created[0]}`, "DELETE")
  created.shift()
  currentUsage = (await request("/api/usage")).data
  assert.equal(currentUsage.drops.used, 2)
  assert.equal(currentUsage.bytes.used, new TextEncoder().encode("# Drop 1\n<h1>New</h1>").byteLength)
  assert.equal(currentUsage.writes.used, 7)
  const uploaded = await request("/api/files", "POST", form)
  assert.equal(uploaded.response.status, 200)
  created.push(uploaded.data.id)
  const image = await request("/api/code", "POST", { code: "const x = 1", format: "svg" })
  assert.equal(image.response.status, 200)
  currentUsage = (await request("/api/usage")).data
  assert.equal(currentUsage.drops.used, 3)
  assert.equal(currentUsage.writes.used, 9)
  assert.ok(currentUsage.bytes.used > expectedBytes)
  console.log("Quota runtime smoke passed: REST/docs/apps/uploads/revisions/guest attribution/code images/deletion")
}
finally {
  for (const id of created) await request(`/api/drops/${id}`, "DELETE")
}
