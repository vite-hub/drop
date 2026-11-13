import { defineHandler } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { faviconUrls, resourceLabel } from "#shared/resources"
import { siteCoversDrop } from "../../utils/content-origin"
import { linkedFrom, relatedDrops } from "../../utils/related"
import { covered, reviewApi, reviewSession, sealDoc } from "../../utils/review"

/**
 * The review script's Related links: the drops related to the reviewed page's origin (server/utils/related.ts), such as
 * a pull request's before/after doc that lists the preview, with their links, like the PR. The search goes two links
 * deep, so a plan doc that lists the same PR comes too.
 *
 * Before someone connects, the page only learns whether any drop links here, so the script knows to show the button.
 * With a token, it gets the drops that person would find in Drop anyway, each with its title, a sealed `open` handle in
 * place of its link (/review/open takes it, with Drop's session), and its links. Links to the page's own origin (the
 * preview itself) and to Drop stay out: the page never learns a drop's link.
 */
export default reviewApi(
  defineHandler(async (event) => {
    if (!event.req.headers.get("authorization")) {
      const origin = event.req.headers.get("origin") ?? ""
      event.res.headers.set("Vary", "Origin")
      event.res.headers.set("Cache-Control", "no-store")
      if (origin) event.res.headers.set("Access-Control-Allow-Origin", origin)
      // The script asks on every page that loads it. An origin no review covers gets the answer of one nothing links
      // to, so the page's console stays quiet and it learns no more than that.
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
          // The host goes after a title, as in the doc's own Related links.
          links: links.map((resource) => ({
            url: resource.url,
            label: resourceLabel(resource),
            detail: resource.title ? new URL(resource.url).hostname.replace(/^www\./, "") : "",
            icons: faviconUrls(resource.url),
          })),
        })),
      ),
    }
  }),
)
