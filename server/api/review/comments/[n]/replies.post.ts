import { HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { readCommentBody, withImages } from "../../../../utils/comment-images"
import { authorOf, findCommentByNumber, replyTo } from "../../../../utils/comments"
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
  if (!input.body && !images.length) throw new HTTPError({ status: 400, statusText: "Write a reply." })
  // The review script names nobody: an `@` from someone else's page stays plain text.
  const author = authorOf(who, who?.name ?? claims.n)
  await withImages(
    site,
    images,
    author.name ?? "Guest",
    (ids) => replyTo(thread, author, input.body, { attachments: ids }),
    (row) => ({ commentId: thread.messages[0]!.id, replyId: row.id }),
  )
  return { ok: true }
})
