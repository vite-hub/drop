import { defineHandler, HTTPError } from "h3"

/** Gates file URLs and shared pages before rendering; all utility imports stay out of the Worker entry. */
export default defineHandler(async (event) => {
  if (event.url.pathname.startsWith("/f/")) {
    const key = decodeURIComponent(event.url.pathname.slice(3))
    if (event.url.searchParams.has("raw") || /\.(html?|shtml|xht(?:ml)?|svgz?)$/i.test(key))
      event.res.headers.set("Content-Security-Policy", "sandbox")
    const { requireBlobAccess } = await import("../utils/content-access")
    await requireBlobAccess(event, key)
    event.context.dropAccessChecked = true
    return
  }
  const page = event.url.pathname.match(/^\/d\/([^/]+)\/?$/)
  if (!page) return
  const [{ expiredLink, findDrop, permissions, waitingForReview }, { identify }] = await Promise.all([
    import("../utils/drops"),
    import("../utils/identity"),
  ])
  const drop = await findDrop(decodeURIComponent(page[1]!), event)
  const who = await identify(event)
  if (waitingForReview(drop, who))
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (expiredLink(drop, who)) throw new HTTPError({ status: 410, statusText: "Expired" })
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "Not found" })
  event.res.headers.set("Cache-Control", "private, no-store")
})
