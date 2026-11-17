import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { saveRetryDelay } from "../../app/utils/backoff.ts"

test("a board save that keeps failing waits twice as long each time, then keeps trying once a minute", () => {
  const delays = [1, 2, 3, 4, 5, 6, 20].map((failures) => saveRetryDelay(failures))
  assert.deepEqual(delays, [5000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
})
