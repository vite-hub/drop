import { useLogger } from "evlog/nitro/v3"
import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { siteMatches } from "#shared/review"
import { siteCoversDrop } from "../../../utils/content-origin"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { addReviewComment, readReviewComment } from "../../../utils/review"

/**
 * A comment from Drop's embedded review: the site open in a frame on its own page, a box drawn over it, and a
 * screenshot the browser's screen capture took. Same multipart body as the review script's, and stored the same way;
 * the reviewer is the one signed in here, so no review token. `?origin=` is the address open in the frame, and the
 * site must cover it. Drop can't see inside the frame, so the comment has no element, and its page is the address
 * typed above the frame.
 */
export default defineHandler(async (event) => {
  const site = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!site || site.kind !== "site" || !permissions(site, who).view) throw new HTTPError({ status: 404, statusText: "No site with that id." })
  if (!permissions(site, who).comment) throw new HTTPError({ status: 403, statusText: "You can't comment on this site." })
  const origin = event.url.searchParams.get("origin") ?? ""
  if (!site.siteUrl || !siteMatches(site.siteUrl, origin) || siteCoversDrop(event, origin)) throw new HTTPError({ status: 400, statusText: "That address isn't part of this site." })
  await requireRateLimit(event, "review-comment", { key: who?.userId, limit: 20, window: "1m" })
  const { input, shot } = await readReviewComment(event)

  const comment = await addReviewComment(site, { who, name: who?.name ?? "Guest" }, input, shot, origin)
  useLogger(event).set({ review: { site: site.id, comment: comment.n, screenshot: Boolean(shot), embedded: true } })
  return { n: comment.n }
})
