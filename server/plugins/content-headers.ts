import { getEventContext, type H3EventContext } from "h3"
import { definePlugin } from "nitro"
import { useRuntimeConfig } from "nitro/runtime-config"
import { HUB_SKILLS_PATH } from "#shared/links"
import { isIndexedPath } from "#shared/utils/docs"

export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    if (!response.headers.has("X-Content-Type-Options")) response.headers.set("X-Content-Type-Options", "nosniff")
    if (!response.headers.has("Referrer-Policy"))
      response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    const path = new URL(event.req.url).pathname
    if (path.startsWith("/f/") || path.startsWith("/d/")) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow")
      if (!HUB_SKILLS_PATH.test(path) || !response.ok) {
        const revalidated =
          path.startsWith("/f/") &&
          (response.status === 304 || (response.status >= 200 && response.status < 300 && response.headers.has("ETag")))
        response.headers.set("Cache-Control", revalidated ? "private, no-cache" : "private, no-store")
      }
    } else {
      const file = /\.(?!md$|txt$)\w+$/.test(path)
      const indexed = useRuntimeConfig().seoIndex && isIndexedPath(path)
      if (!file && !indexed && !response.headers.has("X-Robots-Tag")) response.headers.set("X-Robots-Tag", "noindex")
    }
    const sessionCookies = getEventContext<H3EventContext>(event).dropSessionCookies
    if (sessionCookies?.length) {
      const responseCookies = response.headers.getSetCookie()
      response.headers.delete("Set-Cookie")
      for (const cookie of [...sessionCookies, ...responseCookies]) response.headers.append("Set-Cookie", cookie)
    }
    if (response.headers.has("Set-Cookie")) response.headers.set("Cache-Control", "private, no-store")
  })
})
