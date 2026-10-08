import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { log } from "evlog"
import { migrate, reset, sql, state } from "../cost/harness.mjs"
const { getUsage, withDropQuota } = await import("../../server/utils/quotas.ts")
const { default: cleanup } = await import("../../server/schedules/code-image-cleanup.ts")

migrate()
beforeEach(() => { reset(); state.quotasEnabled = true })

const now = Date.UTC(2026, 9, 8, 12)
const cutoff = now - 15 * 60 * 1000
function reservation(id, createdAt, { committed = false, owner = "owner", month = "2026-10", target = null, drops = 1, bytes = 10, writes = 1 } = {}) {
  sql.prepare("INSERT INTO quota_reservations (id,owner_id,month,drops,bytes,writes,target_id,committed,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, owner, month, drops, bytes, writes, target, Number(committed), createdAt)
}

test("usage and publishing recover stale quota capacity without waiting for the schedule", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now })
  reservation("crashed", cutoff - 1, { drops: 3, bytes: 100 * 1024 * 1024, writes: 1000 })
  const usage = await getUsage("owner")
  for (const unit of ["drops", "bytes", "writes"]) assert.equal(usage[unit].used, 0)
  await withDropQuota("owner", { drops: 1, bytes: 10, writes: 1 }, undefined, async quota => {
    await quota.commit([])
  })
  assert.equal((await getUsage("owner")).writes.used, 1)
  assert.ok(sql.prepare("SELECT id FROM quota_reservations WHERE id='crashed'").get())
})

test("hourly cleanup releases only stale pending reservations and logs each release once", async (t) => {
  const warnings = t.mock.method(log, "warn", () => {})
  reservation("crashed", cutoff - 1, { target: "app" })
  reservation("other-crash", cutoff - 2, { owner: "other", month: "2026-09" })
  reservation("boundary", cutoff)
  reservation("fresh", cutoff + 1)
  reservation("committed", cutoff - 1, { committed: true, drops: 0, bytes: 0, writes: 7 })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.deepEqual(sql.prepare("SELECT id FROM quota_reservations ORDER BY id").all().map(row => row.id), ["boundary", "committed", "fresh"])
  assert.equal(warnings.mock.callCount(), 2)
  const events = warnings.mock.calls.map(call => call.arguments[0]).sort((a, b) => a.reservation.id.localeCompare(b.reservation.id))
  assert.deepEqual(events, [
    { action: "quota-reservation-release", reservation: { id: "crashed", ownerId: "owner", month: "2026-10", targetId: "app", committed: false, drops: 1, bytes: 10, writes: 1, createdAt: cutoff - 1 }, ageMs: 15 * 60 * 1000 + 1 },
    { action: "quota-reservation-release", reservation: { id: "other-crash", ownerId: "other", month: "2026-09", targetId: null, committed: false, drops: 1, bytes: 10, writes: 1, createdAt: cutoff - 2 }, ageMs: 15 * 60 * 1000 + 2 },
  ])
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.equal(warnings.mock.callCount(), 2, "Retries do not log reservations already released")
  reservation("replacement", now, { target: "app" })
})

test("reservation cleanup runs even when subsequent blob cleanup fails", async (t) => {
  const warnings = t.mock.method(log, "warn", () => {})
  reservation("crashed", cutoff - 1)
  sql.prepare("INSERT INTO quota_blobs (blob_key,owner_id,size,expires_at) VALUES ('expired','owner',10,?)").run(now - 1)
  state.failDelete = true
  await assert.rejects(cleanup.handler({ scheduledAt: new Date(now) }), /injected blob delete failure/)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM quota_reservations").get().n, 0)
  assert.equal(warnings.mock.callCount(), 1)
})
