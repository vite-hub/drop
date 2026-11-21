import { useLogger } from "evlog/nitro/v3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { clientAddress } from "../../utils/client-address"
import { withRetryAfter } from "../../utils/comments"
import { logDrop } from "../../utils/logs"
import {
  addReviewComment,
  readReviewComment,
  reviewApi,
  reviewSession,
  reviewThreadOf,
  reviewTiming,
} from "../../utils/review"

export default reviewApi(async (event) => {
  const timing = reviewTiming(event)
  const { site, claims, who, guest } = await reviewSession(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  timing.step("session")
  await withRetryAfter(
    requireRateLimit(event, "review-comment", { key: claims.u ?? clientAddress(event), limit: 20, window: "1m" }),
  )
  timing.step("limit")
  const { input, shot, images } = await readReviewComment(event)
  timing.step("form")

  const { row, attachments } = await addReviewComment(
    site,
    { who, name: claims.n, guest },
    input,
    shot,
    claims.o,
    images,
  )
  timing.step("save")
  logDrop(event, site, { change: "comment" })
  useLogger(event).set({
    review: { site: site.id, comment: row.n, screenshot: Boolean(shot), images: images.length },
  })
  timing.send()
  return attachments ? { n: row.n, thread: reviewThreadOf(site, who, guest, row, attachments) } : { n: row.n }
})
