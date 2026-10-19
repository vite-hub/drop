import { defineValidatedHandler, HTTPError } from "h3"
import { ReviewOpenSchema } from "#shared/schemas"
import { findDrop } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { openable, readReviewToken } from "../../utils/review"

/**
 * Where "Open in Drop" on a reviewed site goes (/review/open). The page holds a review token, so the token alone
 * can't be enough: this opens the review only for people who could open it without its link, with Drop's session.
 */
export default defineValidatedHandler({
  validate: { body: ReviewOpenSchema },
  async handler(event) {
    const who = await identify(event)
    const { token } = await event.req.json()
    const claims = await readReviewToken(event, token)
    const site = claims ? await findDrop(claims.d, event) : null
    if (!who) throw new HTTPError({ status: 401, statusText: "Sign in to open the review." })
    if (!site || site.kind !== "site" || !openable(site, who)) throw new HTTPError({ status: 404, statusText: "Only people the review is shared with can open it. Your comments still reach its owner." })
    event.res.headers.set("Cache-Control", "no-store")
    return { to: `/drops/${site.id}` }
  },
})
