import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"

const DOCUMENT_PATH = /^\/f\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(md|markdown|html))$/i
const MARKDOWN_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src https: data:; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
// Scripts run, but in a sandbox without allow-same-origin: the page gets an opaque origin, so it can't read
// Drop's cookies or call its API with the viewer's session.
const HTML_CONTENT_SECURITY_POLICY = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; font-src data: https:; img-src https: data: blob:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

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

  event.res.headers.set("Cache-Control", event.context.dropPrivate ? "private, no-store" : "public, max-age=60")
  event.res.headers.set("Content-Security-Policy", isHtml ? HTML_CONTENT_SECURITY_POLICY : MARKDOWN_CONTENT_SECURITY_POLICY)
  event.res.headers.set("Content-Type", "text/html; charset=utf-8")
  event.res.headers.set("Referrer-Policy", "no-referrer")
  event.res.headers.set("X-Content-Type-Options", "nosniff")
  if (event.req.method === "HEAD") return ""

  const text = await source.text()
  if (isHtml) return text
  // Loaded lazily: middleware lands in the Worker's entry module, and its static imports would be re-exported
  // from there, which Workers rejects for anything that isn't a handler.
  const { renderMarkdownDocument } = await import("../utils/markdown-document")
  return renderMarkdownDocument(text, event.url.pathname)
})
