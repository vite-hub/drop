import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { H3Event } from "h3"
import { sql, state, migrate, reset, insertDrop, insertVersion, who } from "../cost/harness.mjs"
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: visitHandler } = await import("../../server/api/drops/[id]/visit.post.ts")
const { default: cleanup } = await import("../../server/schedules/cleanup.ts")
const { DAY_MS } = await import("../../shared/expiry.ts")

migrate()
beforeEach(reset)

const now = Date.UTC(2026, 9, 20, 12)
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const beacon = {
  "user-agent": CHROME,
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
}
const navigation = {
  "user-agent": CHROME,
  "sec-fetch-site": "none",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
}
const reader = { ...who, userId: "reader", name: "Reader", email: "reader@example.com", actorName: "Reader" }
const agent = { ...who, actorKind: "agent", actorName: "Claude Code" }

function request(path, { method = "GET", headers = {}, id } = {}) {
  const event = new H3Event(new Request(`https://drop.example${path}`, { method, headers }))
  event.context.log = { set() {}, error() {} }
  if (id) event.context.params = { id }
  return event
}
const open = (id, as, version) => {
  state.who = as
  return detailHandler(request(`/api/drops/${id}${version ? `?v=${version}` : ""}`, { id }))
}
const visit = (id, headers) => {
  state.who = null
  return visitHandler(request(`/api/drops/${id}/visit`, { method: "POST", id, headers }))
}
const viewsOf = async (id) => (await open(id, who)).views

test("each viewer counts once a day, across every version; the owner's own visits don't", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now })
  insertDrop("doc", { visibility: "shared", version: 2 })
  insertVersion("doc", 1)

  await open("doc", who)
  await open("doc", reader, 1)
  await open("doc", reader)
  await open("doc", agent)
  await open("doc", { ...agent, actorName: "Codex" })
  await visit("doc", { ...beacon, "x-forwarded-for": "198.51.100.7" })
  await visit("doc", { ...beacon, "x-forwarded-for": "198.51.100.7" })
  await visit("doc", { ...beacon, "x-forwarded-for": "203.0.113.9" })
  await visit("doc", { "user-agent": "Slackbot-LinkExpanding 1.0", "x-forwarded-for": "192.0.2.1" })
  assert.deepEqual(await viewsOf("doc"), { person: 1, anonymous: 2, agent: 2 })
  assert.deepEqual(
    (await open("doc", who, 1)).views,
    { person: 1, anonymous: 2, agent: 2 },
    "old versions show the doc's views",
  )
  assert.equal((await open("doc", reader)).views, undefined, "only the owner and admins see them")

  vi.advanceTimersByTime(DAY_MS)
  await open("doc", reader)
  await visit("doc", { ...beacon, "x-forwarded-for": "198.51.100.7" })
  assert.deepEqual(await viewsOf("doc"), { person: 2, anonymous: 3, agent: 2 }, "the next day counts again")
})

test("anonymous visitors' ids last the day; the counts stay until the doc is deleted", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now })
  insertDrop("doc", { visibility: "shared" })
  await visit("doc", { ...beacon, "x-forwarded-for": "198.51.100.7" })
  const [viewer] = sql.prepare("SELECT id FROM drop_viewers").all()
  assert.match(viewer.id, /^anon:[0-9a-f]{32}$/, "a hash, never the address")
  assert.doesNotMatch(viewer.id, /198/)

  await cleanup.handler({ scheduledAt: new Date(now + DAY_MS) })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_viewers").get().n, 0)
  assert.deepEqual(await viewsOf("doc"), { person: 0, anonymous: 1, agent: 0 })

  sql.prepare("DELETE FROM drops WHERE id = 'doc'").run()
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_views").get().n, 0)
})

test("a raw file counts when opened, not when embedded; a doc's own images never count", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now })
  insertDrop("photo", { visibility: "shared", kind: "image", blob_key: "photo.png" })
  insertDrop("doc", { visibility: "shared" })
  insertDrop("shot", { visibility: "shared", kind: "image", blob_key: "shot.png", parent_id: "doc" })
  const embedded = { "user-agent": CHROME, "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" }
  await requireBlobAccess(request("/f/photo.png", { headers: embedded }), "photo.png")
  assert.deepEqual(await viewsOf("photo"), { person: 0, anonymous: 0, agent: 0 })
  await requireBlobAccess(request("/f/photo.png", { headers: navigation }), "photo.png")
  await requireBlobAccess(request("/f/shot.png", { headers: navigation }), "shot.png")
  assert.deepEqual(await viewsOf("photo"), { person: 0, anonymous: 1, agent: 0 })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_views WHERE drop_id = 'shot'").get().n, 0)
})
