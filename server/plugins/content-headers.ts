import { H3Event } from "h3"
import { definePlugin } from "nitro"
import { useRuntimeConfig } from "nitro/runtime-config"
import { isIndexedPath } from "../../app/utils/docs"
import { isContentRequest } from "../utils/content-origin"

/**
 * Powerful features Drop never uses stay off on its pages and anything they frame, so a script that slipped in can't
 * ask for them. Screen capture stays on for Drop itself: reviewing a site inside Drop screenshots it that way.
 */
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=(self)"

/** Error handlers replace the response, so set content headers after them too. */
export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    // Never guess a type from the bytes, and send only the origin to other sites: a share link is its own key.
    if (!response.headers.has("X-Content-Type-Options")) response.headers.set("X-Content-Type-Options", "nosniff")
    if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    // Drop's own origin only: drops on the content origin keep the browser's defaults, like any site. Once seen over
    // https, browsers stay on https (never on localhost, where development runs over http). No COOP: the review popup
    // must keep its link to the site that opened it.
    // The hook's type is the bare HTTPEvent; Nitro hands it the full H3Event, which the content check needs.
    const url = new URL(event.req.url)
    if (!(event instanceof H3Event && isContentRequest(event))) {
      if (!response.headers.has("Permissions-Policy")) response.headers.set("Permissions-Policy", PERMISSIONS_POLICY)
      if (url.protocol === "https:" && url.hostname !== "localhost") response.headers.set("Strict-Transport-Security", "max-age=31536000")
    }
    const path = url.pathname
    if (path.startsWith("/f/") || path.startsWith("/d/")) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow")
      response.headers.set("Cache-Control", "private, no-store")
      return
    }
    // When indexing is on, search engines index the landing, docs and legal pages and nothing else: not the app, its API,
    // sign-in, /home, or the Markdown copies of the docs. Without it, nothing. Files (the favicon, og.png, scripts) stay
    // as they are.
    const file = /\.(?!md$|txt$)\w+$/.test(path)
    const indexed = useRuntimeConfig().seoIndex && isIndexedPath(path)
    if (!file && !indexed && !response.headers.has("X-Robots-Tag")) response.headers.set("X-Robots-Tag", "noindex")
  })
})
