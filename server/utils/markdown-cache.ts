import type { H3Event } from "h3"
import { defineCachedFunction } from "nitro/cache"
import { useStorage } from "nitro/storage"

export const MARKDOWN_CACHE_TTL = 60 * 60 * 24 * 30

export interface MarkdownRender {
  title: string
  html: string
  source: string
}
type Render = (text: string) => Promise<{ title: string; html: string }>

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
    // Change this when the renderer's output changes (2: Shiki code blocks, 3: comark-annotate zooms a screenshot's stage
    // with its notes beside it, 4: ::diff renders instead of an unsupported component): every cached render rerenders on
    // its next read.
    integrity: "4",
    getKey: (_event: H3Event | undefined, key: string) => key,
  },
)

export const cachedMarkdown = (key: string, source: () => Promise<string>, render: Render, event?: H3Event) =>
  cached(event, key, source, render)

export async function deleteMarkdownCache(key: string) {
  if (key.startsWith("apps/") || key.startsWith("code-images/")) return
  // Nitro's cached-function key is part of its storage contract; keep this in sync with the `name` above.
  // A spreadsheet's preview (server/utils/spreadsheet.ts) is cached the same way, under its own name.
  await Promise.all(
    ["markdown", "spreadsheet"].map((name) => useStorage("cache").removeItem(`nitro:functions:${name}:${key}.json`)),
  )
}
