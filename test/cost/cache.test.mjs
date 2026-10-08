import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { state, calls } from "./harness.mjs"
const { cachedMarkdown, deleteMarkdownCache, MARKDOWN_CACHE_TTL } = await import("../../server/utils/markdown-cache.ts")
import { oldMarkdownCacheKeys } from "../../scripts/markdown-cache-keys.mjs"

beforeEach(() => { state.entries.clear(); calls.writes.length = 0; state.failCacheDelete = false })
const render = async text => ({ title: text, html: `<p>${text}</p>` })

test("KV writes physically expire in 30 days through the actual unstorage driver", async () => {
  const require = createRequire(import.meta.resolve("nitro/package.json"))
  const { createStorage } = await import(pathToFileURL(require.resolve("unstorage")))
  const { default: driver } = await import(pathToFileURL(require.resolve("unstorage/drivers/cloudflare-kv-binding")))
  const writes = []
  const binding = { get: async () => null, delete: async () => {}, put: async (...args) => writes.push(args) }
  const previous = state.storage
  state.storage = createStorage({ driver: driver({ binding, base: "nitro-cache" }) })
  try {
    if (process.env.DROP_TEST_BASELINE) {
      // Exercise the pinned dependency through the same adapter and options as the old Nitro helper.
      const { defineCachedFunction, setStorage } = await import(pathToFileURL(require.resolve("ocache")))
      setStorage({ get: key => state.storage.getItem(key), set: (key, value, options) => state.storage.setItem(key, value, options?.ttl ? { ttl: options.ttl } : undefined) })
      await defineCachedFunction((_key, text) => render(text), { group: "nitro/functions", name: "markdown", getKey: key => key, maxAge: MARKDOWN_CACHE_TTL })("doc.md", "source")
    }
    else await cachedMarkdown("doc.md", async () => "source", render)
    assert.equal(writes.length, 1)
    assert.equal(writes[0][2].expirationTtl, MARKDOWN_CACHE_TTL)
    assert.equal(MARKDOWN_CACHE_TTL, 2592000)
    assert.equal(JSON.parse(writes[0][1]).value.source, "source")
  }
  finally { state.storage = previous }
})

test("expired memory/filesystem entries refetch and rerender rather than serving stale HTML", async () => {
  const first = await cachedMarkdown("doc.md", async () => "first", render)
  assert.equal(first.source, "first")
  state.entries.get("markdown-v2:doc.md").expires = Date.now() - 1
  const next = await cachedMarkdown("doc.md", async () => "second", render)
  assert.equal(next.html, "<p>second</p>")
  assert.equal(calls.writes.length, 2)
})

test("cache hits do not read source or render again, and deletion removes both cache formats", async () => {
  await cachedMarkdown("doc.md", async () => "source", render)
  const never = () => { throw new Error("unexpected source read or render") }
  assert.equal((await cachedMarkdown("doc.md", never, never)).source, "source")
  state.entries.set("nitro:functions:markdown:doc.md.json", "old cache")
  await deleteMarkdownCache("doc.md")
  assert.equal(state.entries.size, 0)
})

test("the one-time purge selects only old Markdown cache keys", () => {
  assert.deepEqual(oldMarkdownCacheKeys([
    { name: "nitro-cache:nitro:functions:markdown:doc.md.json" },
    { name: "nitro-cache:nitro:handlers:stats:index.json" },
    { name: "nitro-cache:markdown-v2:doc.md" },
    { name: "another-prefix:nitro:functions:markdown:doc.md.json" },
  ]), ["nitro-cache:nitro:functions:markdown:doc.md.json"])
})
