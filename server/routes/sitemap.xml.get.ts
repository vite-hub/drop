import { defineHandler, HTTPError } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import { INDEXED_PATHS } from "#shared/utils/docs"

/** The pages search engines may index (INDEXED_PATHS), on whichever host serves this Drop. None while indexing is off. */
export default defineHandler((event) => {
  if (!useRuntimeConfig().seoIndex) throw new HTTPError({ status: 404, statusText: "Page not found." })
  const origin = event.url.origin
  event.res.headers.set("Content-Type", "application/xml; charset=utf-8")
  event.res.headers.set("Cache-Control", "public, max-age=3600")
  const urls = INDEXED_PATHS.map(path => `  <url><loc>${origin}${path}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
