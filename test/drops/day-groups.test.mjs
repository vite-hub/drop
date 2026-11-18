import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "vite-plus/test"
import { dayGroup } from "../../app/utils/day-groups.ts"

// Node reads TZ again whenever it's assigned, so these days are Madrid's, with their daylight-saving changes.
let zone
beforeEach(() => {
  zone = process.env.TZ
  process.env.TZ = "Europe/Madrid"
})
afterEach(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

const local = (text) => new Date(text).getTime()

test("Yesterday starts at the previous midnight on the 25-hour day clocks go back", () => {
  const now = local("2026-10-26T10:00:00")
  assert.equal(dayGroup(local("2026-10-25T00:30:00"), now), "Yesterday")
  assert.equal(dayGroup(local("2026-10-24T23:30:00"), now), "This week")
})

test("Yesterday starts at the previous midnight on the 23-hour day clocks go forward", () => {
  const now = local("2026-03-30T10:00:00")
  assert.equal(dayGroup(local("2026-03-29T00:30:00"), now), "Yesterday")
  assert.equal(dayGroup(local("2026-03-28T23:30:00"), now), "This week")
})

test("This week holds the six days before today, then a drop goes under its month", () => {
  const now = local("2026-11-04T10:00:00")
  assert.equal(dayGroup(local("2026-11-04T00:00:00"), now), "Today")
  assert.equal(dayGroup(local("2026-10-29T00:00:00"), now), "This week")
  assert.equal(dayGroup(local("2026-10-28T23:59:00"), now), "October 2026")
})

test("before hydration the days are UTC's, so the server and the first render agree", () => {
  const now = Date.UTC(2026, 9, 26, 10)
  assert.equal(dayGroup(Date.UTC(2026, 9, 25, 0, 30), now, "UTC"), "Yesterday")
  assert.equal(dayGroup(Date.UTC(2026, 9, 24, 23, 30), now, "UTC"), "This week")
})
