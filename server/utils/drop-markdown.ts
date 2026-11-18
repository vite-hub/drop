import { FILE_LINK } from "#shared/embedded-images"
import type { DropLink } from "#shared/links"
import type { DropDetail } from "#shared/types"
import type { H3Event } from "h3"
import { HTTPError } from "h3"

/**
 * A Markdown doc or a single HTML page as Markdown, for agents; "Copy as Markdown" uses it for Markdown docs. A
 * Markdown doc is its own source; an HTML page goes through mdream. Links to the drop's files become absolute, so the
 * copy works anywhere. Null for kinds that have no one text to give (apps, folders, images, files, sites).
 */
export async function dropMarkdown(drop: DropDetail, origin: string): Promise<string | null> {
  if (drop.content === undefined) return null
  const source = drop.content.replace(FILE_LINK, (_, path: string) => new URL(path, origin).href)
  if (drop.kind === "markdown") return source
  // Only HTML needs mdream, a native module: a Markdown doc never loads it.
  if (drop.kind === "html") return (await import("mdream")).htmlToMarkdown(source, { origin, minimal: true })
  return null
}

/**
 * A doc's share link as Markdown, at `/d/<link>.md` and `/d/<link>/<slug>.md`. ViteHub Content (`seo.markdown`) also
 * answers the link itself with it for a request that prefers `text/markdown`, or that comes from an AI fetcher. It reads
 * the doc through the API as the reader, so it passes the same gates the page does. Other kinds are a 404.
 */
export async function dropMarkdownResponse(event: H3Event, key: string) {
  const { appFetch } = await import("./app-fetch")
  const read = async <T>(path: string) => {
    const headers = new Headers({ accept: "application/json" })
    for (const name of ["cookie", "authorization", "user-agent"]) {
      const value = event.req.headers.get(name)
      if (value) headers.set(name, value)
    }
    const response = await appFetch(event, path, headers)
    // SAFETY: only Drop's own /api/links and /api/drops routes are read here, and they answer with T.
    return response.ok ? ((await response.json()) as T) : null
  }
  const pinned = event.url.searchParams.get("v")
  const target = await read<DropLink>(
    `/api/links/${encodeURIComponent(key)}${pinned ? `?v=${encodeURIComponent(pinned)}` : ""}`,
  )
  const drop =
    target &&
    (await read<DropDetail>(`/api/drops/${target.id}${target.version === target.latest ? "" : `?v=${target.version}`}`))
  const markdown = drop && (await dropMarkdown(drop, event.url.origin))
  if (!markdown) throw new HTTPError({ status: 404, statusText: "Not found" })
  return new Response(event.req.method === "HEAD" ? null : markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
}
