import assert from "node:assert/strict"
import { H3Event } from "h3"
import { beforeAll, beforeEach, test, vi } from "vite-plus/test"
import { migrate, queries, sql, state } from "../cost/harness.mjs"

const logged = []
vi.mock("evlog/nitro/v3", () => ({
  useLogger: () => ({ info: (message, fields) => logged.push({ level: "info", message, ...fields }) }),
}))
vi.mock("nitro/runtime-config", () => ({
  useRuntimeConfig: () => ({ release: { version: "0.1.0", commit: "90c558bb1234abcd" } }),
}))
const { default: clientEvents } = await import("../../server/api/client-events.post.ts")

function post(body) {
  return clientEvents(
    new H3Event(
      new Request("https://drop.example/api/client-events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
        body: JSON.stringify(body),
      }),
    ),
  )
}
const rows = () =>
  sql
    .prepare("SELECT * FROM ui_usage ORDER BY control, via")
    .all()
    .map((row) => ({ ...row }))

beforeAll(() => migrate({ comments: false }))
beforeEach(() => {
  sql.exec("DELETE FROM ui_usage")
  state.bursts.length = 0
  state.failBurst = false
  delete state.usageCounts
  logged.length = 0
})

const today = new Date().toISOString().slice(0, 10)
const release = "0.1.0+90c558bb"
const batch = {
  event: "ui.usage",
  counts: [
    { kind: "markdown", mode: "browse", control: "comments", via: "shown", count: 1 },
    { kind: "markdown", mode: "browse", control: "comments", via: "click", count: 2 },
    { kind: "markdown", mode: "comment", control: "list", via: "shown", count: 1 },
    { kind: "markdown", mode: "browse", control: "zen", via: "key", count: 1 },
  ],
}

test("a batch adds to the day's shown and pressed rows, with no ids", async () => {
  assert.equal((await post(batch)).status, 204)
  assert.equal((await post(batch)).status, 204)
  assert.deepEqual(rows(), [
    { day: today, release, kind: "markdown", mode: "browse", control: "comments", via: "click", count: 4 },
    { day: today, release, kind: "markdown", mode: "browse", control: "comments", via: "shown", count: 2 },
    { day: today, release, kind: "markdown", mode: "comment", control: "list", via: "shown", count: 2 },
    { day: today, release, kind: "markdown", mode: "browse", control: "zen", via: "key", count: 2 },
  ])
  assert.deepEqual(logged, [
    { level: "info", message: "Client: ui.usage", action: "client-event", client: batch },
    { level: "info", message: "Client: ui.usage", action: "client-event", client: batch },
  ])
})

test("a batch over D1's 100 parameters is split and still lands whole", async () => {
  const counts = ["shown", "click", "key", "palette"].flatMap((via) =>
    ["browse", "comment"].flatMap((mode) =>
      ["markdown", "html", "site"].map((kind) => ({ kind, mode, control: "share", via, count: 3 })),
    ),
  )
  queries.length = 0
  assert.equal((await post({ event: "ui.usage", counts })).status, 204)
  const inserts = queries.filter(({ query }) => query.startsWith("insert into"))
  assert.ok(inserts.length > 1 && inserts.every(({ params }) => params.length <= 100))
  assert.equal(rows().length, 24)
  assert.equal(
    rows().reduce((sum, row) => sum + row.count, 0),
    72,
  )
})

test("pill counts have their own rate limit, so they never use up the sign-in events'", async () => {
  await post(batch)
  assert.deepEqual(state.bursts, [{ bucket: "ui-usage", key: "198.51.100.7", limit: 30, window: "1m" }])
  state.failBurst = true
  await assert.rejects(post(batch), (error) => error.status === 429)
  assert.equal(rows().find((row) => row.via === "click").count, 2)
})

test("with DROP_USAGE_COUNTS off, a batch is answered and nothing is stored or logged", async () => {
  state.usageCounts = false
  assert.equal((await post(batch)).status, 204)
  assert.deepEqual(rows(), [])
  assert.deepEqual(state.bursts, [])
  assert.deepEqual(logged, [])
})

const count = { kind: "markdown", mode: "browse", control: "comments", via: "click", count: 1 }
for (const [label, body] of [
  ["an unknown control", { event: "ui.usage", counts: [{ ...count, control: "stop" }] }],
  ["an unknown way of pressing", { event: "ui.usage", counts: [{ ...count, via: "hover" }] }],
  ["an unknown drop kind", { event: "ui.usage", counts: [{ ...count, kind: "spreadsheet" }] }],
  ["a user id", { event: "ui.usage", counts: [{ ...count, user: "u_123" }] }],
  ["a drop id", { event: "ui.usage", counts: [{ ...count, drop: "2e3wx40eeskg" }] }],
  ["a field on the batch", { event: "ui.usage", counts: [count], page: "/d/2e3wx40eeskg" }],
  ["a zero count", { event: "ui.usage", counts: [{ ...count, count: 0 }] }],
  ["a fractional count", { event: "ui.usage", counts: [{ ...count, count: 1.5 }] }],
  ["an empty batch", { event: "ui.usage", counts: [] }],
  ["more than 200 counts", { event: "ui.usage", counts: Array.from({ length: 201 }, () => count) }],
])
  test(`${label} is a 400 and stores nothing`, async () => {
    await assert.rejects(post(body), (error) => error.status === 400)
    assert.deepEqual(rows(), [])
    assert.deepEqual(logged, [])
  })
