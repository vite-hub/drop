import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import typesetStyles from "../assets/typeset.css?raw"
import { renderMarkdownDocument } from "../utils/markdown-document"

const DOCUMENT_PATH = /^\/i\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(md|markdown|html))$/i
const MARKDOWN_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src https: data:; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const HTML_CONTENT_SECURITY_POLICY = "sandbox allow-scripts; default-src 'none'; font-src data:; img-src https: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export default defineHandler(async (event) => {
  if (!(["GET", "HEAD"].includes(event.req.method)) || event.url.searchParams.has("raw")) return

  const match = event.url.pathname.match(DOCUMENT_PATH)
  const key = match?.[1]
  const extension = match?.[2]
  if (!key || !extension) return
  const isHtml = extension.toLowerCase() === "html"

  const [error, source] = await blob.get(key)
  if (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error.message }))
    throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  }
  if (!source) return

  event.res.headers.set("Cache-Control", "public, max-age=60")
  event.res.headers.set("Content-Security-Policy", isHtml ? HTML_CONTENT_SECURITY_POLICY : MARKDOWN_CONTENT_SECURITY_POLICY)
  event.res.headers.set("Content-Type", "text/html; charset=utf-8")
  event.res.headers.set("Referrer-Policy", "no-referrer")
  event.res.headers.set("X-Content-Type-Options", "nosniff")
  if (event.req.method === "HEAD") return ""

  const text = await source.text()
  return isHtml ? text : renderMarkdownDocument(text, event.url.pathname, typesetStyles)
})
