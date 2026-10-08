import { definePlugin } from "nitro"

/** Error handlers replace the response, so set content headers after them too. */
export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    const path = new URL(event.req.url).pathname
    if (!path.startsWith("/f/") && !path.startsWith("/d/")) return
    response.headers.set("X-Robots-Tag", "noindex, nofollow")
    response.headers.set("Cache-Control", "private, no-store")
  })
})
