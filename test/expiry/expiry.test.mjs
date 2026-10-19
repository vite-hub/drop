import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event } from "h3"
import { sql, state, migrate, reset, insertDrop, who, objects } from "../cost/harness.mjs"
const { createDocDrop, findDrop, findDropByBlob, permissions, listDrops, publishApp } = await import("../../server/utils/drops.ts")
const { isHumanVisit, recordVisit } = await import("../../server/utils/expiry.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: patchHandler } = await import("../../server/api/drops/[id].patch.ts")
const { default: deleteHandler } = await import("../../server/api/drops/[id].delete.ts")
const { default: visitHandler } = await import("../../server/api/drops/[id]/visit.post.ts")
const { default: cleanup } = await import("../../server/schedules/cleanup.ts")
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

test("an expired drop is in the Trash: gone for its link, read-only for its owner, and a visit doesn't revive it", async (t) => {
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
  assert.equal(detail.trashReason, "expired")
  assert.equal(permissions(await findDropByBlob("old.md"), who).edit, false)
  assert.equal(lastAccess("old"), visitedDaysAgo(31))
  assert.match(expiryLabel(detail, now), /^In the Trash, deleting in 14 days$/)
  const can = permissions(await findDropByBlob("old.md"), { ...who, userId: "someone", role: "member" })
  assert.equal(can.view, false)
  assert.deepEqual((await listDrops(who)).map(drop => drop.id), [])
  assert.deepEqual((await listDrops(who, undefined, { trash: true })).map(drop => drop.id).sort(), ["old", "private"])
})

test("restoring brings a drop back from the Trash; new versions and app publishes renew it and keep its lifetime", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  state.who = who
  insertDrop("old", { last_accessed_at: visitedDaysAgo(31) })
  await assert.rejects(patchHandler(request("/api/drops/old", { method: "PATCH", id: "old", body: { renew: true } })), error => error.status === 409, "renewing a trashed drop asks to restore it")
  const restored = await patchHandler(request("/api/drops/old", { method: "PATCH", id: "old", body: { trashed: false } }))
  assert.equal(restored.expiresAt, now + 30 * DAY_MS)
  assert.equal(restored.trashedAt, null)
  assert.equal((await findDrop("old")).expired, false)

  insertDrop("doc", { last_accessed_at: visitedDaysAgo(25), lifetime: "keep" })
  const next = await createDocDrop(who, { filename: "doc.md", bytes: new TextEncoder().encode("# Two"), supersedes: "doc", note: "Second pass" })
  assert.equal(lastAccess("doc"), now)
  assert.equal(next.lifetime, "keep", "a new version keeps the chain's lifetime")
  assert.equal(next.note, "Second pass")

  const app = await publishApp(who, { files: { "index.html": "<p>1</p>" }, lifetime: "temporary" })
  sql.prepare("UPDATE drops SET last_accessed_at = ? WHERE id = ?").run(visitedDaysAgo(10), app.id)
  const v2 = await publishApp(who, { id: app.id, files: { "index.html": "<p>2</p>" }, note: "v2" })
  assert.equal(lastAccess(app.id), now)
  assert.equal(v2.lifetime, "temporary")
})

test("temporary drops expire after 14 days, review after 30, kept ones never", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("temp", { lifetime: "temporary", last_accessed_at: visitedDaysAgo(15) })
  insertDrop("review", { last_accessed_at: visitedDaysAgo(15) })
  insertDrop("kept", { lifetime: "keep", last_accessed_at: visitedDaysAgo(400) })
  assert.equal((await findDrop("temp")).expired, true)
  assert.equal((await findDrop("review")).expired, false)
  assert.equal((await findDrop("kept")).expired, false)
  state.expiryDays = 7
  assert.equal((await findDrop("review")).expired, true, "a shorter Drop-wide window caps temporary and review alike")
})

test("agents keep a drop when they say why; people just choose; admins can limit keeping to themselves", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("doc")
  insertDrop("doc2", { supersedes_id: "doc", version: 2 })
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
  await assert.rejects(patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep" } })), error => error.status === 400)
  await assert.rejects(patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep", keepReason: "x".repeat(281) } })), error => error.status === 400)
  const kept = await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep", keepReason: "Screenshot for vite-hub/drop#12." } }))
  assert.equal(kept.lifetime, "keep")
  assert.equal(kept.keepReason, "Screenshot for vite-hub/drop#12.")
  assert.equal(kept.expiresAt, null)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops WHERE lifetime = 'keep' AND keep_reason IS NOT NULL").get().n, 2)

  state.who = who
  const temporary = await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "temporary" } }))
  assert.equal(temporary.keepReason, null)
  assert.equal(temporary.expiresAt, now + 14 * DAY_MS, "choosing a lifetime starts its window now")
  assert.equal((await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep" } }))).keepReason, null)

  state.customExpiry = false
  await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "review" } }))
  await assert.rejects(patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep" } })), error => error.status === 403)
  state.who = { ...who, role: "admin" }
  assert.equal((await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { lifetime: "keep" } }))).lifetime, "keep")
})

test("deleting moves a drop to the Trash; only people delete for good", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("doc")
  insertDrop("doc2", { supersedes_id: "doc", version: 2 })
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
  const trashed = await deleteHandler(request("/api/drops/doc2", { method: "DELETE", id: "doc2" }))
  assert.equal(trashed.trashReason, "deleted")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops WHERE trashed_at = ?").get(now).n, 2, "every version goes")
  const agent = state.who
  state.who = null
  await assert.rejects(requireBlobAccess(request("/f/doc2.md", { headers: navigation }), "doc2.md"), error => error.status === 404, "its link stops working")
  state.who = agent
  await assert.rejects(deleteHandler(request("/api/drops/doc2?forever", { method: "DELETE", id: "doc2" })), error => error.status === 403)
  await patchHandler(request("/api/drops/doc2", { method: "PATCH", id: "doc2", body: { trashed: false } }))
  assert.equal((await findDrop("doc2")).expired, false)

  state.who = who
  await deleteHandler(request("/api/drops/doc2?forever", { method: "DELETE", id: "doc2" }))
  assert.equal(exists("doc"), false)
  assert.equal(objects.has("doc.md"), false)
})

test("hourly cleanup moves expired drops to the Trash and deletes them 15 days later, with their files", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  insertDrop("gone", { last_accessed_at: visitedDaysAgo(46) })
  insertDrop("gone-v2", { supersedes_id: "gone", version: 2, last_accessed_at: visitedDaysAgo(46) })
  insertDrop("shot", { kind: "image", blob_key: "shot.png", filename: "shot.png", parent_id: "gone-v2" })
  insertDrop("trash", { last_accessed_at: visitedDaysAgo(40) })
  insertDrop("deleted", { trashed_at: now - 16 * DAY_MS, trash_reason: "deleted" })
  insertDrop("temp", { lifetime: "temporary", last_accessed_at: visitedDaysAgo(20) })
  insertDrop("kept", { last_accessed_at: visitedDaysAgo(400), lifetime: "keep" })
  insertDrop("fresh", { last_accessed_at: visitedDaysAgo(1) })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.deepEqual(["gone", "gone-v2", "shot", "trash", "deleted", "temp", "kept", "fresh"].filter(exists), ["trash", "temp", "kept", "fresh"])
  assert.equal(objects.has("gone.md"), false)
  assert.equal(objects.has("shot.png"), false, "a doc's attachments go with it")
  assert.equal(objects.has("trash.md"), true)
  const moved = id => sql.prepare("SELECT trashed_at AS at, trash_reason AS reason FROM drops WHERE id = ?").get(id)
  assert.deepEqual({ ...moved("trash") }, { at: visitedDaysAgo(10), reason: "expired" }, "in the Trash as of when it expired")
  assert.deepEqual({ ...moved("temp") }, { at: visitedDaysAgo(6), reason: "expired" })
  assert.equal(moved("fresh").at, null)
})

test("files a doc embeds belong to it: shared, trashed, and counted with the doc", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  state.who = who
  insertDrop("shot", { kind: "image", blob_key: "11111111-2222-4333-8444-555555555555.png", filename: "shot.png", visibility: "private" })
  insertDrop("theirs", { kind: "image", blob_key: "66666666-2222-4333-8444-555555555555.png", filename: "theirs.png", visibility: "private", owner_id: "someone" })
  const doc = await createDocDrop(who, { filename: "doc.md", share: "public_comment", lifetime: "keep", bytes: new TextEncoder().encode("![a](https://drop.example/f/11111111-2222-4333-8444-555555555555.png?raw) ![b](/f/66666666-2222-4333-8444-555555555555.png)") })
  assert.equal((await findDrop("shot")).parentId, doc.id)
  assert.equal((await findDrop("theirs")).parentId, null, "someone else's file never joins your doc")
  const shot = await findDrop("shot")
  assert.equal(shot.share, "public_comment")
  assert.equal(shot.lifetime, "keep")
  state.who = null
  await requireBlobAccess(request("/f/11111111-2222-4333-8444-555555555555.png", { headers: navigation }), "11111111-2222-4333-8444-555555555555.png")
  state.who = who
  assert.deepEqual((await listDrops(who)).map(drop => drop.id), [doc.id], "attachments hide behind their doc")
  const detail = await detailHandler(request(`/api/drops/${doc.id}`, { id: doc.id }))
  assert.deepEqual(detail.attachments.map(file => file.id), ["shot"])

  const next = await createDocDrop(who, { filename: "doc.md", supersedes: doc.id, bytes: new TextEncoder().encode("![a](/f/11111111-2222-4333-8444-555555555555.png)") })
  assert.equal((await findDrop("shot")).parentId, next.id, "a new version takes the attachment along")
  await patchHandler(request(`/api/drops/${next.id}`, { method: "PATCH", id: next.id, body: { trashed: true } }))
  state.who = null
  await assert.rejects(requireBlobAccess(request("/f/11111111-2222-4333-8444-555555555555.png", { headers: navigation }), "11111111-2222-4333-8444-555555555555.png"), error => error.status === 404)
})

test("DROP_EXPIRY_DAYS=0 keeps every drop and hides expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  state.expiryDays = 0
  insertDrop("ancient", { last_accessed_at: visitedDaysAgo(400) })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.ok(exists("ancient"))
  const [summary] = await listDrops(who)
  assert.equal(summary.expiresAt, null)
  assert.equal(permissions(await findDrop("ancient"), null).view, true)
})
