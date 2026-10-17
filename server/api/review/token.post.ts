import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { siteMatches } from "#shared/review"
import { ReviewTokenSchema } from "#shared/schemas"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { openChoice, signReviewToken } from "../../utils/review"

/**
 * The connect popup asks here for a review token for the site drop the person picked (/api/review/sites). The token
 * is for that drop and the page's origin only, and the popup posts it to that origin only: any page could open the
 * popup, but none other gets the token.
 */
export default defineValidatedHandler({
  validate: { body: ReviewTokenSchema },
  async handler(event) {
    const who = await identify(event)
    await requireRateLimit(event, "review-token", { key: who?.userId, limit: 20, window: "1m" })
    const { origin, choice, name } = await event.req.json() as { origin: string; choice: string; name?: string }
    const id = await openChoice(event, choice, origin, who)
    const site = id ? await findDrop(id, event) : null
    if (!site || site.kind !== "site" || !site.siteUrl || !siteMatches(site.siteUrl, origin) || !permissions(site, who).comment)
      throw new HTTPError({ status: 404, statusText: "You can't comment on this site anymore, or its review was deleted. Press Comment on the site again." })
    // A guest's name says it's a guest's, so nobody signs a comment as the site's owner.
    const author = who ? who.name : name?.trim() ? `${name.trim()} (guest)` : "Guest"
    const { token, expiresAt } = await signReviewToken(event, { d: site.id, u: who?.userId ?? null, n: author, o: origin })
    event.res.headers.set("Cache-Control", "no-store")
    return { token, expiresAt, origin, title: site.title, name: author }
  },
})
