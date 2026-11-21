import { HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { clientAddress } from "../../../../utils/client-address"
import { lists, readCommentBody, withImages } from "../../../../utils/comment-images"
import { authorOf, earlierReply, findCommentByNumber, replyTo, TOO_MANY_COMMENTS } from "../../../../utils/comments"
import { logDrop } from "../../../../utils/logs"
import { routeNumber } from "../../../../utils/review-params"
import { reviewApi, reviewSession } from "../../../../utils/review"

export default reviewApi(async (event) => {
  const { site, claims, who, guest } = await reviewSession(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  await requireRateLimit(event, "review-comment", {
    key: claims.u ?? clientAddress(event),
    limit: 20,
    window: "1m",
    message: TOO_MANY_COMMENTS,
  })
  const thread = await findCommentByNumber(site, await routeNumber(event))
  if (!thread) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  if (!input.body && !images.length) throw new HTTPError({ status: 400, statusText: "Write a reply." })
  const author = authorOf(who, who?.name ?? claims.n, guest)
  if (input.requestId && (await earlierReply(thread, input.requestId, author))) return { ok: true }
  await withImages(
    site,
    images,
    author.name ?? "Guest",
    (ids) =>
      replyTo(thread, author, input.body, {
        attachments: ids,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      }),
    (row, ids) => (lists(row, ids) ? { commentId: thread.messages[0]!.id, replyId: row.id } : null),
  )
  logDrop(event, site, { change: "reply" })
  return { ok: true }
})
