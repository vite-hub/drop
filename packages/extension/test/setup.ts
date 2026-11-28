import { beforeEach, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"

// The lib modules import `browser` from wxt/browser; tests get WXT's in-memory fake, with the APIs it doesn't
// implement (identity, scripting, permissions) stubbed per test.
vi.mock("wxt/browser", async () => ({ browser: (await import("wxt/testing/fake-browser")).fakeBrowser }))

beforeEach(() => {
  fakeBrowser.reset()
  // Each test loads the lib modules fresh, so caches and the single-flight refresh start empty.
  vi.resetModules()
})
