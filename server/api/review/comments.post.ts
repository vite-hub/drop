import { useLogger } from "evlog/nitro/v3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { addReviewComment, readReviewComment, reviewApi, reviewSession } from "../../utils/review"

/**
 * A comment from a site under review: `data` (JSON, ReviewCommentSchema), an optional `screenshot` of the viewport,
 * and the `image`s the reviewer added, as multipart. The token decides the site drop. Everything here comes from someone else's page, so it's checked like
 * any upload: the screenshot by its bytes, not its claimed type, and at most 4 MiB. The answer is the comment's number
 * only, nothing that would open the review.
 */
export default reviewApi(async (event) => {
  const { site, claims, who } = await reviewSession(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  await requireRateLimit(event, "review-comment", { key: claims.u ?? undefined, limit: 20, window: "1m" })
  const { input, shot, images } = await readReviewComment(event)

  const comment = await addReviewComment(site, { who, name: claims.n }, input, shot, claims.o, images)
  useLogger(event).set({
    review: { site: site.id, comment: comment.number, screenshot: Boolean(shot), images: images.length },
  })
  return { n: comment.number }
})
