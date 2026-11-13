import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { clock, startTime } from "../../shared/video-time.ts"

test("a video's link starts at the second its ?t= names, written as seconds, a clock, or 1m15s", () => {
  assert.equal(startTime("75"), 75)
  assert.equal(startTime("75.5"), 75.5)
  assert.equal(startTime("75s"), 75)
  assert.equal(startTime("1:15"), 75)
  assert.equal(startTime("1:02:07"), 3727)
  assert.equal(startTime("1m15s"), 75)
  assert.equal(startTime("1h"), 3600)
  for (const nothing of [undefined, "", "soon", "-4", "1:2:3:4"]) assert.equal(startTime(nothing), 0)
})

test("a second shows as the player shows it", () => {
  assert.equal(clock(0), "0:00")
  assert.equal(clock(12.9), "0:12")
  assert.equal(clock(75), "1:15")
  assert.equal(clock(3727), "1:02:07")
})
