import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { initLogger } from "evlog"
import { migrate, reset, sql, state } from "../cost/harness.mjs"
const { getUsage, withDropQuota } = await import("../../server/utils/quotas.ts")
const { default: cleanup } = await import("../../server/schedules/cleanup.ts")

// The cleanup's run events, one per run.
const runs = []
initLogger({ silent: true, drain: ({ event }) => void runs.push(event) })

migrate()
beforeEach(() => {
  reset()
  runs.length = 0
  state.quotasEnabled = true
})

const now = Date.UTC(2026, 9, 8, 12)
const cutoff = now - 15 * 60 * 1000
function reservation(
  id,
  createdAt,
  { committed = false, owner = "owner", month = "2026-10", target = null, drops = 1, bytes = 10, writes = 1 } = {},
) {
  sql
    .prepare(
      "INSERT INTO quota_reservations (id,owner_id,month,drops,bytes,writes,target_id,committed,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(id, owner, month, drops, bytes, writes, target, Number(committed), createdAt)
}

test("usage and publishing recover stale quota capacity without waiting for the schedule", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now })
  reservation("crashed", cutoff - 1, { drops: 3, bytes: 100 * 1024 * 1024, writes: 1000 })
  const usage = await getUsage("owner")
  for (const unit of ["drops", "bytes", "writes"]) assert.equal(usage[unit].used, 0)
  await withDropQuota("owner", { drops: 1, bytes: 10, writes: 1 }, undefined, async (quota) => {
    await quota.commit([])
  })
  assert.equal((await getUsage("owner")).writes.used, 1)
  assert.ok(sql.prepare("SELECT id FROM quota_reservations WHERE id='crashed'").get())
})

test("hourly cleanup releases only stale pending reservations and logs each release once", async () => {
  reservation("crashed", cutoff - 1, { target: "app" })
  reservation("other-crash", cutoff - 2, { owner: "other", month: "2026-09" })
  reservation("boundary", cutoff)
  reservation("fresh", cutoff + 1)
  reservation("committed", cutoff - 1, { committed: true, drops: 0, bytes: 0, writes: 7 })
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.deepEqual(
    sql
      .prepare("SELECT id FROM quota_reservations ORDER BY id")
      .all()
      .map((row) => row.id),
    ["boundary", "committed", "fresh"],
  )
  assert.equal(runs.length, 1)
  const step = runs[0].steps.quotaReservations
  assert.equal(step.released, 2)
  assert.deepEqual(
    step.reservations.sort((a, b) => a.id.localeCompare(b.id)),
    [
      {
        id: "crashed",
        ownerId: "owner",
        month: "2026-10",
        targetId: "app",
        committed: false,
        drops: 1,
        bytes: 10,
        writes: 1,
        createdAt: cutoff - 1,
        ageMs: 15 * 60 * 1000 + 1,
      },
      {
        id: "other-crash",
        ownerId: "other",
        month: "2026-09",
        targetId: null,
        committed: false,
        drops: 1,
        bytes: 10,
        writes: 1,
        createdAt: cutoff - 2,
        ageMs: 15 * 60 * 1000 + 2,
      },
    ],
  )
  await cleanup.handler({ scheduledAt: new Date(now) })
  assert.equal(runs[1].steps.quotaReservations.released, 0, "Retries do not log reservations already released")
  assert.equal(runs[1].steps.quotaReservations.reservations, undefined)
  reservation("replacement", now, { target: "app" })
})

test("reservation cleanup runs even when subsequent blob cleanup fails", async () => {
  reservation("crashed", cutoff - 1)
  sql
    .prepare("INSERT INTO code_images (blob_key,owner_id,size,expires_at) VALUES ('expired','owner',10,?)")
    .run(now - 1)
  state.failDelete = true
  await assert.rejects(cleanup.handler({ scheduledAt: new Date(now) }), /injected blob delete failure/)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM quota_reservations").get().n, 0)
  assert.equal(runs[0].steps.quotaReservations.released, 1)
  assert.deepEqual(runs[0].failed, ["codeImages"])
})

test("each member's limits follow their own tier, and anything else falls back to the Drop's default plan", async () => {
  assert.equal((await getUsage("owner")).plan, "free")
  assert.equal((await getUsage("owner")).drops.limit, 50)
  sql.prepare("UPDATE user SET plan = 'pro' WHERE id = 'owner'").run()
  const pro = await getUsage("owner")
  assert.equal(pro.plan, "pro")
  assert.deepEqual([pro.drops.limit, pro.bytes.limit, pro.writes.limit], [null, 1024 * 1024 * 1024, 10_000])
  // Admins pick Free or Pro; an old `unlimited` row doesn't lift the limits.
  sql.prepare("UPDATE user SET plan = 'unlimited' WHERE id = 'owner'").run()
  assert.equal((await getUsage("owner")).plan, "free")
})
