import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import typesetStyles from "../assets/typeset.css?raw"
import { renderMarkdownDocument } from "../utils/markdown-document"

export default defineHandler(async (event) => {
  if (!(["GET", "HEAD"].includes(event.req.method)) || event.url.searchParams.has("raw")) return

  const key = event.url.pathname.slice("/i/".length)
  const [error, source] = await blob.get(key)
  if (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error.message }))
    throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  }
  if (!source) return

  event.res.headers.set("Cache-Control", "public, max-age=60")
  event.res.headers.set("Content-Security-Policy", "default-src 'none'; img-src https: data:; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  event.res.headers.set("Content-Type", "text/html; charset=utf-8")
  event.res.headers.set("Referrer-Policy", "no-referrer")
  event.res.headers.set("X-Content-Type-Options", "nosniff")
  if (event.req.method === "HEAD") return ""

  return renderMarkdownDocument(await source.text(), event.url.pathname, typesetStyles)
})
