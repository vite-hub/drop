import { eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { commentReplies, comments } from "../../../databases/config"
import { attachImages, imageParent, readCommentBody, withImages } from "../../../utils/comment-images"
import { insertReply, replyOf } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Reply in a comment's thread: anyone who may comment on the drop, like a new comment. Images as for a comment. */
export default defineHandler(async (event) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, await routeId(event)))
    .limit(1)
  const drop = comment ? await findDrop(comment.dropId, event) : null
  const who = await identify(event)
  if (!comment || !drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't reply to this comment." })
  // Replies share the comment limit: a thread is no way around it.
  await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  // The images go where the comment's own would.
  const parent = images.length ? await imageParent(drop) : drop
  const { row, attachments } = await withImages(
    images,
    () => insertReply(comment, who, input.body),
    (added) =>
      attachImages(parent, images, { commentId: comment.id, replyId: added.id, n: comment.n }, added.authorName),
    (added) => db.delete(commentReplies).where(eq(commentReplies.id, added.id)),
  )
  return replyOf(row, who, attachments)
})
