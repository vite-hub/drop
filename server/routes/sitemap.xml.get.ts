import { defineHandler } from "h3"
import { INDEXED_PATHS } from "#shared/utils/docs"

/** The pages search engines may index (INDEXED_PATHS), on whichever host serves this Drop. */
export default defineHandler((event) => {
  const origin = event.url.origin
  event.res.headers.set("Content-Type", "application/xml; charset=utf-8")
  event.res.headers.set("Cache-Control", "public, max-age=3600")
  const urls = INDEXED_PATHS.map(path => `  <url><loc>${origin}${path}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
