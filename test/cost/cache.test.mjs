import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { state, calls } from "./harness.mjs"
const { cachedMarkdown, deleteMarkdownCache, MARKDOWN_CACHE_TTL } = await import("../../server/utils/markdown-cache.ts")

const KEY = "nitro:functions:markdown:doc.md.json"
beforeEach(() => {
  state.entries.clear()
  calls.writes.length = 0
  state.failCacheDelete = false
})
const render = async (text) => ({ title: text, html: `<p>${text}</p>` })

test("KV writes physically expire in 30 days through the actual unstorage driver", async () => {
  const require = createRequire(import.meta.resolve("nitro/package.json"))
  const { createStorage } = await import(pathToFileURL(require.resolve("unstorage")))
  const { default: driver } = await import(pathToFileURL(require.resolve("unstorage/drivers/cloudflare-kv-binding")))
  const writes = []
  const binding = { get: async () => null, delete: async () => {}, put: async (...args) => writes.push(args) }
  const previous = state.storage
  state.storage = createStorage({ driver: driver({ binding, base: "nitro-cache" }) })
  try {
    await cachedMarkdown("doc.md", async () => "source", render)
    // Nitro writes after it answers (waitUntil on Workers); let the write land.
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(writes.length, 1)
    assert.equal(writes[0][0], `nitro-cache:${KEY}`)
    assert.equal(writes[0][2].expirationTtl, MARKDOWN_CACHE_TTL)
    assert.equal(MARKDOWN_CACHE_TTL, 2592000)
    assert.equal(JSON.parse(writes[0][1]).value.source, "source")
  } finally {
    state.storage = previous
  }
})

test("off Cloudflare the memory cache keeps a 30-day render instead of dropping it at once", async () => {
  // Nitro's default cache storage on Node. Unpatched, unstorage turns the TTL into a setTimeout above 2^31-1 ms, which
  // Node fires after 1 ms (TimeoutOverflowWarning), so every render was thrown away (patches/unstorage@*.patch).
  const require = createRequire(import.meta.resolve("nitro/package.json"))
  const { createStorage } = await import(pathToFileURL(require.resolve("unstorage")))
  const previous = state.storage
  state.storage = createStorage()
  try {
    await cachedMarkdown("doc.md", async () => "source", render)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(await state.storage.getItem(KEY), "the render should still be cached")
  } finally {
    state.storage.dispose()
    state.storage = previous
  }
})

test("expired memory/filesystem entries refetch and rerender rather than serving stale HTML", async () => {
  const first = await cachedMarkdown("doc.md", async () => "first", render)
  assert.equal(first.source, "first")
  state.entries.get(KEY).mtime = Date.now() - MARKDOWN_CACHE_TTL * 1000 - 1
  const next = await cachedMarkdown("doc.md", async () => "second", render)
  assert.equal(next.html, "<p>second</p>")
  assert.equal(calls.writes.length, 2)
})

test("cache hits do not read source or render again, and deletion removes the render", async () => {
  await cachedMarkdown("doc.md", async () => "source", render)
  const never = () => {
    throw new Error("unexpected source read or render")
  }
  assert.equal((await cachedMarkdown("doc.md", never, never)).source, "source")
  await deleteMarkdownCache("doc.md")
  assert.equal(state.entries.size, 0)
})
