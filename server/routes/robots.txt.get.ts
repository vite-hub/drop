import { defineHandler } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"

// Shared drops and files stay uncrawled. Other pages outside the sitemap may be crawled, but answer with noindex
// (server/plugins/content-headers.ts), which a crawler has to fetch the page to see. With indexing off there's no
// sitemap: every page answers noindex.
export default defineHandler(event => {
  event.res.headers.set("Content-Type", "text/plain; charset=utf-8")
  const sitemap = useRuntimeConfig().seoIndex ? `\nSitemap: ${event.url.origin}/sitemap.xml\n` : ""
  return `User-agent: *\nDisallow: /f/\nDisallow: /d/\nDisallow: /api/\n${sitemap}`
})
