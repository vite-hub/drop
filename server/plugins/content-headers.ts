import { definePlugin } from "nitro"
import { isIndexedPath } from "../../app/utils/docs"

/** Error handlers replace the response, so set content headers after them too. */
export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    // Never guess a type from the bytes, and send only the origin to other sites: a share link is its own key.
    if (!response.headers.has("X-Content-Type-Options")) response.headers.set("X-Content-Type-Options", "nosniff")
    if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    const path = new URL(event.req.url).pathname
    if (path.startsWith("/f/") || path.startsWith("/d/")) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow")
      response.headers.set("Cache-Control", "private, no-store")
      return
    }
    // Search engines index the landing, docs and legal pages and nothing else: not the app, its API, sign-in, /home,
    // or the Markdown copies of the docs. Files (the favicon, og.png, scripts) stay as they are.
    const file = /\.(?!md$|txt$)\w+$/.test(path)
    if (!file && !isIndexedPath(path) && !response.headers.has("X-Robots-Tag")) response.headers.set("X-Robots-Tag", "noindex")
  })
})
