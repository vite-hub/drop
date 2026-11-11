import assert from "node:assert/strict"
import { resolveCacheKeys } from "ocache"
import { beforeEach, test } from "vite-plus/test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { state, calls } from "./harness.mjs"
const { cachedMarkdown, deleteMarkdownCache, MARKDOWN_CACHE_TTL } = await import("../../server/utils/markdown-cache.ts")
const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const [KEY] = await resolveCacheKeys({
  options: { base: "", group: "nitro/functions", name: "markdown", getKey: () => "doc.md" },
})
beforeEach(() => {
  state.entries.clear()
  calls.writes.length = 0
  state.failCacheDelete = false
})
const render = async (text) => ({ title: text, html: `<p>${text}</p>` })
// Nitro's own unstorage, as the server stores renders with it.
const unstorage = createRequire(import.meta.resolve("nitro/package.json"))
const { createStorage } = await import(pathToFileURL(unstorage.resolve("unstorage")))

test("KV writes physically expire in 30 days through the actual unstorage driver", async () => {
  const { default: driver } = await import(pathToFileURL(unstorage.resolve("unstorage/drivers/cloudflare-kv-binding")))
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
  // Before unstorage alpha.11, this TTL overflowed setTimeout and evicted the render after 1 ms.
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

test("renders from an older release of Drop's renderer are refreshed on the next read", async () => {
  // Before the comments preset, and from an older comark-ui.
  for (const integrity of ["13", "0.7.6+drop.18"]) {
    state.entries.set(KEY, {
      integrity,
      mtime: Date.now(),
      value: { title: "Old", html: "<p>old</p>", source: "source" },
    })
    calls.writes.length = 0
    const next = await cachedMarkdown("doc.md", async () => "source", render)
    assert.equal(next.html, "<p>source</p>")
    assert.equal(calls.writes.length, 1)
  }
})

test("a warm embed card from before the Drop player is refreshed on the next read", async () => {
  const source = '::embed{url="https://drop.vitehub.dev/d/k7f2q9m4x8wd" title="Demo"}\n::'
  state.entries.set(KEY, {
    integrity: "0.10.1+drop.18",
    mtime: Date.now(),
    value: {
      title: "Untitled document",
      html: '<a class="ce-card" href="https://drop.vitehub.dev/d/k7f2q9m4x8wd">Demo</a>',
      source,
    },
  })
  let reads = 0
  const next = await renderMarkdownCached("doc.md", async () => {
    reads++
    return source
  })
  assert.match(next.html, /data-drop-embed="k7f2q9m4x8wd"/)
  assert.doesNotMatch(next.html, /ce-card|render-error/)
  assert.equal(reads, 1)
  assert.equal(calls.writes.length, 1)
  const hit = await renderMarkdownCached("doc.md", () => {
    throw new Error("the refreshed render should be cached")
  })
  assert.equal(hit.html, next.html)
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
