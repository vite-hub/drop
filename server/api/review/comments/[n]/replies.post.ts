import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { commentReplies } from "../../../../databases/config"
import { attachImages, readCommentBody, withImages } from "../../../../utils/comment-images"
import { findCommentByNumber, insertReply } from "../../../../utils/comments"
import { routeNumber } from "../../../../utils/review-params"
import { reviewApi, reviewSession } from "../../../../utils/review"

/** A reply from the site's page, as JSON or multipart with images, like a reply in Drop. */
export default reviewApi(async (event) => {
  const { site, claims, who } = await reviewSession(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  await requireRateLimit(event, "review-comment", { key: claims.u ?? undefined, limit: 20, window: "1m" })
  const comment = await findCommentByNumber(site, await routeNumber(event))
  if (!comment) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  await withImages(
    images,
    () => insertReply(comment, who, input.body, claims.n),
    (row) => attachImages(site, images, { commentId: comment.id, replyId: row.id, n: comment.n }, row.authorName),
    (row) => db.delete(commentReplies).where(eq(commentReplies.id, row.id)),
  )
  return { ok: true }
})
