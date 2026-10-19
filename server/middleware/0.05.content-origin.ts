import { defineHandler } from "h3"

/**
 * Requests on the content origin get the frame host and nothing else: no API, no pages, no files. Frame and
 * document loads get the host page; anything else (an app fetching a missing file, say) is a 404. So is every host
 * that only looks like a content origin.
 */
export default defineHandler(async (event) => {
  const { FRAME_HOST_HTML, contentHost } = await import("../utils/content-origin")
  const host = contentHost(event)
  if (!host) return
  if (host === "stray")
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    })
  const destination = event.req.headers.get("sec-fetch-dest")
  const page =
    ["GET", "HEAD"].includes(event.req.method) &&
    (!destination || destination === "iframe" || destination === "document")
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
