import { defineHandler } from "h3"

/**
 * Requests on the content origin get the frame host and the app's own files, nothing else: no API, no pages. Frame
 * and document loads get the host page; other loads get the app's file when the frame holds its grant, and a 404
 * otherwise (an app fetching a missing file, say). So does every host that only looks like a content origin.
 */
export default defineHandler(async (event) => {
  const { FRAME_HOST_HTML, contentHost } = await import("../utils/content-origin")
  const host = contentHost(event)
  if (!host) return
  if (host === "stray" || /^\/(?:_vitehub|api\/_vitehub\/console)(?:\/|$)/.test(event.url.pathname))
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    })
  const destination = event.req.headers.get("sec-fetch-dest")
  const read = ["GET", "HEAD"].includes(event.req.method)
  const page = read && (!destination || destination === "iframe" || destination === "document")
  // Anything else an app loads (scripts, styles, fonts, fetch) is one of its files, for a frame that holds its grant.
  if (read && !page && host === "content") {
    const { serveAppFile } = await import("../utils/app-files")
    const file = await serveAppFile(event)
    if (file) return file
  }
  return new Response(page && event.req.method === "GET" ? FRAME_HOST_HTML : page ? null : "Not found", {
    status: page ? 200 : 404,
    headers: {
      "Content-Type": page ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
})
