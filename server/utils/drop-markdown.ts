import { FILE_LINK } from "#shared/embedded-images"
import type { DropLink } from "#shared/links"
import type { DropDetail } from "#shared/types"
import type { H3Event } from "h3"
import { HTTPError } from "h3"

async function dropMarkdown(drop: DropDetail, origin: string): Promise<string | null> {
  if (drop.content === undefined) return null
  const source = drop.content.replace(FILE_LINK, (_, path: string) => new URL(path, origin).href)
  if (drop.kind === "markdown") return source
  if (drop.kind === "html") return (await import("mdream")).htmlToMarkdown(source, { origin, minimal: true })
  return null
}

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
    (await read<DropDetail>(
      `/api/drops/${target.id}${pinned || target.version !== target.latest ? `?v=${target.version}` : ""}`,
    ))
  const markdown = drop && (await dropMarkdown(drop, event.url.origin))
  if (markdown === null) throw new HTTPError({ status: 404, statusText: "Not found" })
  return new Response(event.req.method === "HEAD" ? null : markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
}
