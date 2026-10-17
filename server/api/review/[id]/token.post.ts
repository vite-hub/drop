import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ReviewTokenSchema } from "#shared/schemas"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { signReviewToken } from "../../../utils/review"

/**
 * The connect popup (/review/connect) asks here, on Drop's own origin and with Drop's session, for a review token for
 * the page that opened it. Only the site's own origin gets one: otherwise any page could open the popup and collect
 * tokens for someone else's review. The popup then posts it to that origin only.
 */
export default defineValidatedHandler({
  validate: { body: ReviewTokenSchema },
  async handler(event) {
    const site = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!site || site.kind !== "site" || !site.siteUrl || !permissions(site, who).comment) {
      // Signed out, a review that needs sign-in looks the same as one that doesn't exist.
      if (!who) throw new HTTPError({ status: 401, statusText: "Sign in to comment on this site." })
      throw new HTTPError({ status: 404, statusText: "You can't comment on this site, or its review was deleted." })
    }
    await requireRateLimit(event, "review-token", { key: who?.userId, limit: 20, window: "1m" })
    const { origin, name } = await event.req.json() as { origin: string; name?: string }
    if (origin !== site.siteUrl) throw new HTTPError({ status: 403, statusText: `This review is for ${site.siteUrl}, not ${origin}.` })
    // A guest's name says it's a guest's, so nobody signs a comment as the site's owner.
    const author = who ? who.name : name?.trim() ? `${name.trim()} (guest)` : "Guest"
    const { token, expiresAt } = await signReviewToken(event, { d: site.id, u: who?.userId ?? null, n: author, o: site.siteUrl })
    event.res.headers.set("Cache-Control", "no-store")
    return { token, expiresAt, siteUrl: site.siteUrl, title: site.title, name: author }
  },
})
