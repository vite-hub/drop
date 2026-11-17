import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { saveRetryDelay } from "../../app/utils/backoff.ts"

test("a board save that keeps failing waits twice as long each time, at most a minute, and gives up after six", () => {
  const delays = [1, 2, 3, 4, 5, 6, 7].map((failures) => saveRetryDelay(failures))
  assert.deepEqual(delays, [5000, 10_000, 20_000, 40_000, 60_000, undefined, undefined])
})
