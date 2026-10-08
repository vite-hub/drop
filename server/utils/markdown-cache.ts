import { useStorage } from "nitro/storage"

export const MARKDOWN_CACHE_TTL = 60 * 60 * 24 * 30
const PREFIX = "markdown-v2:"

export interface MarkdownRender { title: string; html: string; source: string }
interface Entry { expires: number; value: MarkdownRender }

/** The TTL reaches KV's expirationTtl; expires also bounds memory and filesystem caches. */
export async function cachedMarkdown(key: string, source: () => Promise<string>, render: (text: string) => Promise<{ title: string; html: string }>): Promise<MarkdownRender> {
  const storage = useStorage("cache")
  const entry = await storage.getItem<Entry>(PREFIX + key)
  if (entry && entry.expires > Date.now()) return entry.value
  if (entry) await storage.removeItem(PREFIX + key)
  const text = await source()
  const value = { ...await render(text), source: text }
  await storage.setItem(PREFIX + key, { expires: Date.now() + MARKDOWN_CACHE_TTL * 1000, value }, { ttl: MARKDOWN_CACHE_TTL })
  return value
}

export async function deleteMarkdownCache(key: string) {
  if (key.startsWith("apps/") || key.startsWith("code-images/")) return
  const storage = useStorage("cache")
  await storage.removeItem(PREFIX + key)
  // Remove renders written by the previous Nitro helper as well.
  await storage.removeItem(`nitro:functions:markdown:${key}.json`)
}
