import { defineHandler } from "h3"

export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method)) return
  const { pathname } = event.url
  if (!pathname.endsWith(".md")) return
  const { DOCS_PAGES } = await import("#shared/utils/docs")
  const path = pathname.slice(0, -".md".length)
  if (!DOCS_PAGES.some((page) => page.to === path)) return
  const { appFetch } = await import("../utils/app-fetch")
  const response = await appFetch(event, path, { accept: "text/html" })
  if (!response.ok) return
  const html = await response.text()
  const page = html.match(/<article\b[\s\S]*<\/article>/)?.[0] ?? html.match(/<main\b[\s\S]*<\/main>/)?.[0]
  if (!page) return
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
