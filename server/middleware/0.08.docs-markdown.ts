import { defineHandler } from "h3"

/**
 * Every docs page as Markdown, for agents: at its path plus `.md` (/docs/agents.md), or at its own path for a request
 * that prefers `text/markdown` to HTML. It's the page's own server render, converted, so it never drifts from
 * what people read, and it passes the same gates. Links to other docs pages point at their `.md`.
 */
export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method)) return
  const { pathname } = event.url
  const accept = event.req.headers.get("accept") ?? ""
  const suffixed = pathname.endsWith(".md")
  if (!suffixed && !(accept.includes("text/markdown") && (await import("../../shared/accept")).prefersMarkdown(accept))) return
  // Loaded lazily: middleware lands in the Worker's entry module, which may only export handlers.
  const { DOCS_PAGES } = await import("../../app/utils/docs")
  const path = suffixed ? pathname.slice(0, -".md".length) : pathname.replace(/(.)\/$/, "$1")
  if (!DOCS_PAGES.some(page => page.to === path)) return
  const { htmlToMarkdown } = await import("../utils/html-markdown")
  // A sub-request through this app, not the network; it keeps the platform runtime (bindings) of this request.
  const request = Object.assign(new Request(new URL(path, event.url), { headers: { accept: "text/html" } }), { runtime: event.req.runtime })
  const response = await event.app!.fetch(request)
  if (!response.ok) return
  const html = await response.text()
  const page = html.match(/<article\b[\s\S]*<\/article>/)?.[0] ?? html.match(/<main\b[\s\S]*<\/main>/)?.[0]
  if (!page) return
  return new Response(event.req.method === "HEAD" ? null : htmlToMarkdown(page, event.url.origin), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300", "Vary": "Accept" },
  })
})
