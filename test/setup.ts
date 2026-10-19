import { afterEach, vi } from "vite-plus/test"

// Tests that freeze Date get the real clock back, as node:test's per-test mocks did.
afterEach(() => {
  vi.useRealTimers()
})
