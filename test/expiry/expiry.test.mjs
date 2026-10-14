import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event } from "h3"
import { sql, state, migrate, reset, insertDrop, who, objects } from "../cost/harness.mjs"
const { createDocDrop, findDrop, findDropByBlob, permissions, listDrops, publishApp } = await import("../../server/utils/drops.ts")
const { isHumanVisit, recordVisit } = await import("../../server/utils/expiry.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: patchHandler } = await import("../../server/api/drops/[id].patch.ts")
const { default: visitHandler } = await import("../../server/api/drops/[id]/visit.post.ts")
const { default: cleanup } = await import("../../server/schedules/code-image-cleanup.ts")
const { DAY_MS, expiryLabel } = await import("../../shared/expiry.ts")

migrate()
beforeEach(reset)

const now = Date.UTC(2026, 9, 13, 12)
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const beacon = { "user-agent": CHROME, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }
const navigation = { "user-agent": CHROME, "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }
const lastAccess = id => sql.prepare("SELECT last_accessed_at AS at FROM drops WHERE id = ?").get(id)?.at
const exists = id => Boolean(sql.prepare("SELECT id FROM drops WHERE id = ?").get(id))

function request(path, { method = "GET", headers = {}, body, id } = {}) {
  const event = new H3Event(new Request(`https://drop.example${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }))
  event.context.log = { set() {}, error() {} }
  if (id) event.context.params = { id }
  return event
}
const visitedDaysAgo = days => now - days * DAY_MS

test("only browsers that ran the page or opened the file count as anonymous visits", () => {
  assert.equal(isHumanVisit(new Headers(beacon), "beacon"), true)
  assert.equal(isHumanVisit(new Headers(navigation), "document"), true)
  for (const agent of ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "facebookexternalhit/1.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36", "curl/8.7.1", ""])
    assert.equal(isHumanVisit(new Headers({ ...beacon, "user-agent": agent }), "beacon"), false, agent)
  // A cross-site beacon, or an image embedded elsewhere, is not someone reading the drop.
  assert.equal(isHumanVisit(new Headers({ ...beacon, "sec-fetch-site": "cross-site" }), "beacon"), false)
  assert.equal(isHumanVisit(new Headers({ ...navigation, "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" }), "document"), false)
})

test("a visit restarts the window for every version, at most once a day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("v1", { last_accessed_at: visitedDaysAgo(10) })
  insertDrop("v2", { supersedes_id: "v1", version: 2, last_accessed_at: visitedDaysAgo(10) })
  await recordVisit(request("/api/drops/v1"), await findDrop("v1"), who, "beacon")
  assert.equal(lastAccess("v1"), now)
  assert.equal(lastAccess("v2"), now)

  t.mock.timers.tick(DAY_MS / 2)
  const before = sql.prepare("SELECT total_changes() AS n").get().n
  await recordVisit(request("/api/drops/v2"), await findDrop("v2"), who, "beacon")
  assert.equal(sql.prepare("SELECT total_changes() AS n").get().n, before, "a second visit the same day writes nothing")
  assert.equal(lastAccess("v2"), now)
})

test("anonymous unfurlers don't keep a drop alive; a reader's beacon does", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("shared", { last_accessed_at: visitedDaysAgo(20) })
  await visitHandler(request("/api/drops/shared/visit", { method: "POST", id: "shared", headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } }))
  assert.equal(lastAccess("shared"), visitedDaysAgo(20))
  await visitHandler(request("/api/drops/shared/visit", { method: "POST", id: "shared", headers: beacon }))
  assert.equal(lastAccess("shared"), now)
})

test("a raw file counts when opened directly, not when embedded", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("file", { blob_key: "file.png", kind: "image", last_accessed_at: visitedDaysAgo(20) })
  await requireBlobAccess(request("/f/file.png", { headers: { "user-agent": CHROME, "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors", "sec-fetch-site": "cross-site" } }), "file.png")
  assert.equal(lastAccess("file"), visitedDaysAgo(20))
  await requireBlobAccess(request("/f/file.png", { headers: navigation }), "file.png")
  assert.equal(lastAccess("file"), now)
})

test("an expired drop is gone for its link, read-only for its owner, and a visit doesn't revive it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("old", { last_accessed_at: visitedDaysAgo(31) })
  insertDrop("private", { visibility: "private", last_accessed_at: visitedDaysAgo(31) })
  await assert.rejects(detailHandler(request("/api/drops/old", { id: "old" })), error => error.status === 410)
  await assert.rejects(detailHandler(request("/api/drops/private", { id: "private" })), error => error.status === 404, "private drops never reveal they existed")
  await assert.rejects(requireBlobAccess(request("/f/old.md", { headers: navigation }), "old.md"), error => error.status === 404)

  state.who = who
  const detail = await detailHandler(request("/api/drops/old", { id: "old" }))
  assert.equal(detail.isOwner, true)
  assert.equal(detail.canComment, false)
  assert.equal(permissions(await findDropByBlob("old.md"), who).edit, false)
  assert.equal(lastAccess("old"), visitedDaysAgo(31))
  assert.match(expiryLabel(detail, now), /^Expired, deleting in 6 days$/)
  const can = permissions(await findDropByBlob("old.md"), { ...who, userId: "someone", role: "member" })
  assert.equal(can.view, false)
})

test("renewing restores an expired drop; new versions and app publishes renew it too", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  state.who = who
  insertDrop("old", { last_accessed_at: visitedDaysAgo(31) })
  const renewed = await patchHandler(request("/api/drops/old", { method: "PATCH", id: "old", body: { renew: true } }))
  assert.equal(renewed.expiresAt, now + 30 * DAY_MS)
  assert.equal((await findDrop("old")).expired, false)

  insertDrop("doc", { last_accessed_at: visitedDaysAgo(25), never_expires: 1 })
  const next = await createDocDrop(who, { filename: "doc.md", bytes: new TextEncoder().encode("# Two"), supersedes: "doc" })
  assert.equal(lastAccess("doc"), now)
  assert.equal(next.neverExpires, true, "a new version keeps the chain's lifetime")

  const app = await publishApp(who, { files: { "index.html": "<p>1</p>" } })
  sql.prepare("UPDATE drops SET last_accessed_at = ? WHERE id = ?").run(visitedDaysAgo(25), app.id)
  await publishApp(who, { id: app.id, files: { "index.html": "<p>2</p>" } })
  assert.equal(lastAccess(app.id), now)
})

test("agents can only ask to keep a drop forever; owners approve, and admins can turn the option off", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("doc")
  insertDrop("doc2", { supersedes_id: "doc", version: 2 })
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
  const asked = await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { neverExpires: true } }))
  assert.equal(asked.neverExpires, false)
  assert.equal(asked.neverExpiresRequest, "Claude Code")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops WHERE never_expires_request = 'Claude Code'").get().n, 2)

  state.who = who
  const kept = await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { neverExpires: true } }))
  assert.equal(kept.neverExpires, true)
  assert.equal(kept.neverExpiresRequest, null)
  assert.equal(kept.expiresAt, null)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops WHERE never_expires = 1").get().n, 2)

  state.customExpiry = "0"
  await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { neverExpires: false } }))
  await assert.rejects(patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { neverExpires: true } })), error => error.status === 403)
  state.who = { ...who, role: "admin" }
  assert.equal((await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { neverExpires: true } }))).neverExpires, true)
})

test("hourly cleanup deletes drops a week past expiry, with their files, and skips kept drops", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("gone", { last_accessed_at: visitedDaysAgo(38) })
  insertDrop("gone-v2", { supersedes_id: "gone", version: 2, last_accessed_at: visitedDaysAgo(38) })
  insertDrop("grace", { last_accessed_at: visitedDaysAgo(36) })
  insertDrop("kept", { last_accessed_at: visitedDaysAgo(400), never_expires: 1 })
  insertDrop("fresh", { last_accessed_at: visitedDaysAgo(1) })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.deepEqual(["gone", "gone-v2", "grace", "kept", "fresh"].filter(exists), ["grace", "kept", "fresh"])
  assert.equal(objects.has("gone.md"), false)
  assert.equal(objects.has("gone-v2.md"), false)
  assert.equal(objects.has("grace.md"), true)
})

test("DROP_EXPIRY_DAYS=0 keeps every drop and hides expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  state.expiryDays = "0"
  insertDrop("ancient", { last_accessed_at: visitedDaysAgo(400) })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.ok(exists("ancient"))
  const [summary] = await listDrops(who)
  assert.equal(summary.expiresAt, null)
  assert.equal(permissions(await findDrop("ancient"), null).view, true)
})
