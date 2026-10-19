import { defineHandler } from "h3"

// Shared drops and files stay uncrawled. Other pages outside the sitemap may be crawled, but answer with noindex
// (server/plugins/content-headers.ts), which a crawler has to fetch the page to see.
export default defineHandler(event => {
  event.res.headers.set("Content-Type", "text/plain; charset=utf-8")
  return `User-agent: *\nDisallow: /f/\nDisallow: /d/\nDisallow: /api/\n\nSitemap: ${event.url.origin}/sitemap.xml\n`
})
