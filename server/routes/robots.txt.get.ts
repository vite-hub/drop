import { defineHandler } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"

// Shared drops and files stay crawlable on purpose. They answer with `noindex, nofollow`
// (server/plugins/content-headers.ts), and a crawler has to fetch a page to see that header. A Disallow rule hides the
// header, so Google can still list a linked share URL, which is its own key, without a snippet. Other pages outside the
// sitemap answer noindex the same way. With indexing off there's no sitemap: every page answers noindex.
export default defineHandler((event) => {
  event.res.headers.set("Content-Type", "text/plain; charset=utf-8")
  const sitemap = useRuntimeConfig().seoIndex ? `\nSitemap: ${event.url.origin}/sitemap.xml\n` : ""
  return `User-agent: *\nDisallow: /api/\n${sitemap}`
})
