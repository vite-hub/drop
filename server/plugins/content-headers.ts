import { definePlugin } from "nitro"

/** Error handlers replace the response, so set content headers after them too. */
export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    // Never guess a type from the bytes, and send only the origin to other sites: a share link is its own key.
    if (!response.headers.has("X-Content-Type-Options")) response.headers.set("X-Content-Type-Options", "nosniff")
    if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    const path = new URL(event.req.url).pathname
    if (!path.startsWith("/f/") && !path.startsWith("/d/")) return
    response.headers.set("X-Robots-Tag", "noindex, nofollow")
    response.headers.set("Cache-Control", "private, no-store")
  })
})
