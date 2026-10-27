import type { H3Event } from "h3"
import { defineCachedFunction } from "nitro/cache"
import { useStorage } from "nitro/storage"
import { resolveCacheKeys } from "ocache"

export const MARKDOWN_CACHE_TTL = 60 * 60 * 24 * 30

export interface MarkdownRender {
  title: string
  html: string
  source: string
  /** A network failure left something out, such as an icon, so the render isn't kept and the next read tries again. */
  retry?: true
}
type Render = (text: string) => Promise<{ title: string; html: string; retry?: true }>

/**
 * Renders keyed by blob key, in Nitro's `cache` storage (KV on Cloudflare, memory elsewhere). Blobs never change
 * once uploaded, so nothing invalidates a render but deleting its blob. `swr: false` makes Nitro hand the 30-day TTL
 * to KV's expirationTtl, so unread renders disappear there too, and rerender an expired entry instead of serving it.
 * The event lets the write outlive the response on Workers (`waitUntil`).
 */
const cached = defineCachedFunction(
  async (
    _event: H3Event | undefined,
    _key: string,
    source: () => Promise<string>,
    render: Render,
  ): Promise<MarkdownRender> => {
    const text = await source()
    return { ...(await render(text)), source: text }
  },
  {
    name: "markdown",
    maxAge: MARKDOWN_CACHE_TTL,
    swr: false,
    // Bump when the renderer changes so existing documents pick up the current preset on their next read.
    integrity: "13",
    validate: (entry: { value?: MarkdownRender }) => entry.value !== undefined && !entry.value.retry,
    getKey: (_event: H3Event | undefined, key: string) => key,
  },
)

export const cachedMarkdown = (key: string, source: () => Promise<string>, render: Render, event?: H3Event) =>
  cached(event, key, source, render)

export async function deleteMarkdownCache(key: string) {
  if (key.startsWith("apps/") || key.startsWith("code-images/")) return
  const storage = useStorage("cache")
  await Promise.all(
    ["markdown", "spreadsheet"].map(async (name) => {
      const keys = await resolveCacheKeys({ options: { base: "", group: "nitro/functions", name, getKey: () => key } })
      await Promise.all(keys.map((entry) => storage.removeItem(entry)))
    }),
  )
}
