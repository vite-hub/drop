import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { faviconUrls, resourceLabel } from "#shared/resources"
import { siteCoversDrop } from "../../utils/content-origin"
import { resourcesOf } from "../../utils/resources"
import { covered, docsLinkingTo, linkedFrom, reviewApi, reviewSession, sealDoc } from "../../utils/review"

/**
 * The drops that link to the reviewed page's origin, for the review script's "Drop document" menu: a pull request's
 * before/after doc lists the PR and its preview, so the preview's reviewers can get back to both.
 *
 * Before someone connects, the page only learns whether any drop links here, so the script knows to show the option.
 * With a token, it gets the ones that person would find in Drop anyway, each with its title, a sealed `open` handle in
 * place of its link (/review/open takes it, with Drop's session), and its other links. Links to the page's own origin
 * (the preview itself) and to Drop stay out: the page never learns a drop's link.
 */
export default reviewApi(
  defineHandler(async (event) => {
    if (!event.req.headers.get("authorization")) {
      const origin = event.req.headers.get("origin") ?? ""
      event.res.headers.set("Vary", "Origin")
      event.res.headers.set("Cache-Control", "no-store")
      if (!(await covered(origin))) throw new HTTPError({ status: 404, statusText: "No site review here." })
      event.res.headers.set("Access-Control-Allow-Origin", origin)
      await requireRateLimit(event, "review-docs", { limit: 30, window: "1m" })
      return { linked: await linkedFrom(origin) }
    }
    const { claims, who } = await reviewSession(event)
    const docs = await docsLinkingTo(claims.o, who, event)
    return {
      linked: docs.length > 0,
      docs: await Promise.all(
        docs.map(async (doc) => ({
          open: await sealDoc(event, doc, claims.e),
          title: doc.title,
          links: resourcesOf(doc)
            .filter((resource) => {
              const { origin } = new URL(resource.url)
              return origin !== claims.o && !siteCoversDrop(event, origin)
            })
            .map((resource) => {
              const label = resourceLabel(resource)
              const host = new URL(resource.url).hostname.replace(/^www\./, "")
              return { url: resource.url, label, host: label === host ? "" : host, icons: faviconUrls(resource.url) }
            }),
        })),
      ),
    }
  }),
)
