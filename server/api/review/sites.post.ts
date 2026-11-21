import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { siteAddressesFor } from "#shared/review"
import { ReviewSitesSchema } from "#shared/schemas"
import { identify } from "../../utils/identity"
import { sealChoice, sitesFor } from "../../utils/review"

export default defineValidatedHandler({
  validate: { body: ReviewSitesSchema },
  async handler(event) {
    const who = await identify(event)
    await requireRateLimit(event, "review-token", { key: who?.userId, limit: 20, window: "1m" })
    const { origin } = await event.req.json()
    if (!siteAddressesFor(origin).length)
      throw new HTTPError({ status: 400, statusText: "Drop reviews pages on https, or http on localhost." })
    const found = await sitesFor(origin, who, event)
    event.res.headers.set("Cache-Control", "no-store")
    return {
      origin,
      sites: await Promise.all(
        found.map(async ({ site, owner }) => ({
          choice: await sealChoice(event, site, origin, who),
          title: site.title,
          owner,
          address: site.siteUrl!,
        })),
      ),
    }
  },
})
