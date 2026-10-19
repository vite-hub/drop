import type { DropLink } from "#shared/links"
import type { DropDetail } from "#shared/types"
import { defineHandler } from "h3"

const DOC_PATH = /^\/d\/([^/]+?)(?:\/([^/]+?))?(\.md)?$/
// Fetchers that read a page for a person's chat (ChatGPT, Claude, Perplexity). The doc renders in a frame once the
// page's script runs, so its HTML alone carries only the title; they get the text instead.
const AI_FETCHER = /ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|Perplexity-User|PerplexityBot/i

/**
 * A doc's share link as Markdown: `/d/<link>/<slug>.md`, or the link itself for a request that prefers
 * `text/markdown` to HTML, or comes from an AI fetcher. Markdown docs and single HTML pages only; anything else
 * falls through to the page. It reads the doc through the API, so it passes the same gates the page does.
 */
export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method)) return
  const match = event.url.pathname.match(DOC_PATH)
  if (!match) return
  const [, key, , suffix] = match
  const accept = event.req.headers.get("accept") ?? ""
  const asked = accept.includes("text/markdown") && (await import("../../shared/accept")).prefersMarkdown(accept)
  const wanted = suffix || asked || AI_FETCHER.test(event.req.headers.get("user-agent") ?? "")
  if (!wanted || !key) return
  // A sub-request through this app, as the reader: same cookies, same platform runtime (bindings) as this request.
  const read = async <T>(path: string) => {
    const headers = new Headers({ accept: "application/json" })
    for (const name of ["cookie", "authorization", "user-agent"]) {
      const value = event.req.headers.get(name)
      if (value) headers.set(name, value)
    }
    const response = await event.app!.fetch(Object.assign(new Request(new URL(path, event.url), { headers }), { runtime: event.req.runtime }))
    // SAFETY: only Drop's own /api/links and /api/drops routes are read here, and they answer with T.
    return response.ok ? await response.json() as T : null
  }
  const pinned = event.url.searchParams.get("v")
  const target = await read<DropLink>(`/api/links/${encodeURIComponent(key)}${pinned ? `?v=${encodeURIComponent(pinned)}` : ""}`)
  const drop = target && await read<DropDetail>(`/api/drops/${target.id}`)
  if (!drop) return
  const { dropMarkdown } = await import("../utils/drop-markdown")
  const markdown = dropMarkdown(drop, event.url.origin)
  if (markdown === null) return
  return new Response(event.req.method === "HEAD" ? null : markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Vary": "Accept, User-Agent",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
})
