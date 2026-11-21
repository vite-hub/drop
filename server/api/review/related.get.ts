import { defineHandler } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { faviconUrl, resourceLabel } from "#shared/resources"
import { siteCoversDrop } from "../../utils/content-origin"
import { linkedFrom, relatedDrops } from "../../utils/related"
import { covered, reviewApi, reviewSession, sealDoc } from "../../utils/review"

export default reviewApi(
  defineHandler(async (event) => {
    if (!event.req.headers.get("authorization")) {
      const origin = event.req.headers.get("origin") ?? ""
      event.res.headers.set("Vary", "Origin")
      event.res.headers.set("Cache-Control", "no-store")
      if (origin) event.res.headers.set("Access-Control-Allow-Origin", origin)
      if (!(await covered(origin))) return { linked: false }
      await requireRateLimit(event, "review-related", { limit: 30, window: "1m" })
      return { linked: await linkedFrom(origin) }
    }
    const { claims, who } = await reviewSession(event)
    const groups = await relatedDrops([{ origin: claims.o }], who, event, {
      hide: (url) => siteCoversDrop(event, new URL(url).origin),
    })
    return {
      linked: groups.length > 0,
      groups: await Promise.all(
        groups.map(async ({ drop, links }) => ({
          open: await sealDoc(event, drop, claims.e),
          title: drop.title,
          links: links.map((resource) => ({
            url: resource.url,
            label: resourceLabel(resource),
            detail: resource.title ? new URL(resource.url).hostname.replace(/^www\./, "") : "",
            icons: [faviconUrl(resource.url, event.url.origin)],
          })),
        })),
      ),
    }
  }),
)
