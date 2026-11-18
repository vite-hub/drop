import { defineHandler } from "h3"

/**
 * Every docs page as Markdown, for agents, at its path plus `.md` (/docs/agents.md). ViteHub Content (`seo.markdown`,
 * server/content.ts) answers the page's own path with it too, for a request that prefers `text/markdown` or comes from
 * an AI fetcher. It's the page's own server render, converted, so it never drifts from what people read, and it passes
 * the same gates. Links to other docs pages point at their `.md`.
 *
 * Middleware, not a route: a route can't match `/docs/**` plus `.md`. Content's `pages: true` would convert the docs
 * too, but it skips pages that answer `X-Robots-Tag: noindex`, which every page does while `seoIndex` is off.
 */
export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method)) return
  const { pathname } = event.url
  if (!pathname.endsWith(".md")) return
  // Loaded lazily: middleware lands in the Worker's entry module, which may only export handlers.
  const { DOCS_PAGES } = await import("#shared/utils/docs")
  const path = pathname.slice(0, -".md".length)
  if (!DOCS_PAGES.some((page) => page.to === path)) return
  const { appFetch } = await import("../utils/app-fetch")
  const response = await appFetch(event, path, { accept: "text/html" })
  if (!response.ok) return
  const html = await response.text()
  const page = html.match(/<article\b[\s\S]*<\/article>/)?.[0] ?? html.match(/<main\b[\s\S]*<\/main>/)?.[0]
  if (!page) return
  // Links between docs pages point at their Markdown too. Figures are screenshots and the landing stories
  // (DocsFigure): the text around them says what they show.
  const linked = page.replace(
    /href="(\/docs(?:\/[^"#?]*)?)([#?][^"]*)?"/g,
    (_, to: string, rest = "") => `href="${to.replace(/\/$/, "")}.md${rest}"`,
  )
  const markdown = (await import("mdream")).htmlToMarkdown(linked, {
    origin: event.url.origin,
    clean: { selfLinkHeadings: true },
    filter: { exclude: ["figure", "button", "nav", "svg"] },
  })
  return new Response(event.req.method === "HEAD" ? null : `${markdown}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  })
})
