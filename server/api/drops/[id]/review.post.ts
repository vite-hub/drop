import { useLogger } from "evlog/nitro/v3"
import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { siteMatches } from "#shared/review"
import { clientAddress } from "../../../utils/client-address"
import { refuseSend, requireSender } from "../../../utils/comment-images"
import { siteCoversDrop } from "../../../utils/content-origin"
import { TOO_MANY_COMMENTS } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { routeId } from "../../../utils/params"
import { addReviewComment, readReviewComment } from "../../../utils/review"

export default defineHandler(async (event) => {
  const site = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!site || site.kind !== "site" || !permissions(site, who).view)
    return refuseSend(event, who, new HTTPError({ status: 404, statusText: "No site with that id." }))
  if (!permissions(site, who).comment)
    return refuseSend(event, who, new HTTPError({ status: 403, statusText: "You can't comment on this site." }))
  const origin = event.url.searchParams.get("origin") ?? ""
  if (!site.siteUrl || !siteMatches(site.siteUrl, origin) || siteCoversDrop(event, origin))
    throw new HTTPError({ status: 400, statusText: "That address isn't part of this site." })
  await requireRateLimit(event, "review-comment", {
    key: who?.userId ?? clientAddress(event),
    limit: 20,
    window: "1m",
    message: TOO_MANY_COMMENTS,
  })
  const { input, shot, images } = await readReviewComment(event)
  requireSender(who, input.as)

  const { row: comment } = await addReviewComment(
    site,
    { who, name: who?.name ?? "Guest", guest: who ? null : await guestOf(event, { mint: true }) },
    input,
    shot,
    origin,
    images,
  )
  logDrop(event, site, { change: "comment" })
  useLogger(event).set({
    review: { site: site.id, comment: comment.n, screenshot: Boolean(shot), embedded: true },
  })
  return { n: comment.n, id: comment.id }
})
