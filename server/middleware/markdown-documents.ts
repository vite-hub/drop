import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { renderMarkdownDocument } from "../utils/markdown-document"

const MARKDOWN_PATH = /^\/i\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:md|markdown))$/i

export default defineHandler(async (event) => {
  if (!(["GET", "HEAD"].includes(event.req.method)) || event.url.searchParams.has("raw")) return

  const key = event.url.pathname.match(MARKDOWN_PATH)?.[1]
  if (!key) return

  const [error, source] = await blob.get(key)
  if (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error.message }))
    throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  }
  if (!source) return

  const html = await renderMarkdownDocument(await source.text(), event.url.pathname)
  event.res.headers.set("Cache-Control", "public, max-age=60")
  event.res.headers.set("Content-Security-Policy", "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  event.res.headers.set("Content-Type", "text/html; charset=utf-8")
  event.res.headers.set("Referrer-Policy", "no-referrer")
  event.res.headers.set("X-Content-Type-Options", "nosniff")
  return html
})
