import type { H3Event } from "h3"
import { defineCachedFunction } from "nitro/cache"
import { useStorage } from "nitro/storage"
import { resolveCacheKeys } from "ocache"
import { version as comarkUiVersion } from "comark-ui/package.json"

export const MARKDOWN_CACHE_TTL = 60 * 60 * 24 * 30
export const FAILED_RENDER_TTL = 5 * 60

interface MarkdownRender {
  title: string
  html: string
  source: string
  retry?: true
  failed?: true
}
type Render = (text: string) => Promise<{ title: string; html: string; retry?: true; failed?: true }>

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
    integrity: `${comarkUiVersion}+drop.37`,
    validate: (entry: { value?: MarkdownRender }) => entry.value !== undefined && !entry.value.retry,
    getMaxAge: (entry: { value?: MarkdownRender }) => (entry.value?.failed ? FAILED_RENDER_TTL : MARKDOWN_CACHE_TTL),
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
