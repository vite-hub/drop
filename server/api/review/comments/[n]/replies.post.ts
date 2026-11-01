import { HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { attachImages, readCommentBody, withImages } from "../../../../utils/comment-images"
import { authorOf, findCommentByNumber, replyTo, undoReply } from "../../../../utils/comments"
import { routeNumber } from "../../../../utils/review-params"
import { reviewApi, reviewSession } from "../../../../utils/review"

/** A reply from the site's page, as JSON or multipart with images, like a reply in Drop. */
export default reviewApi(async (event) => {
  const { site, claims, who } = await reviewSession(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  await requireRateLimit(event, "review-comment", { key: claims.u ?? undefined, limit: 20, window: "1m" })
  const thread = await findCommentByNumber(site, await routeNumber(event))
  if (!thread) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  await withImages(
    images,
    () => replyTo(thread, authorOf(who, who?.name ?? claims.n), input.body),
    (row) =>
      attachImages(
        site,
        images,
        { commentId: thread.comments[0]!.id, replyId: row.id, n: thread.number },
        row.author.name,
      ),
    undoReply,
  )
  return { ok: true }
})
