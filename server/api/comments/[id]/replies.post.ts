import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { imageParent, readCommentBody, withImages } from "../../../utils/comment-images"
import { actorOf, authorOf, findThread, replyTo, toReply } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Reply in a comment's thread: anyone who may comment on the drop, like a new comment. Images as for a comment. */
export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId, event) : null
  const who = await identify(event)
  if (!thread || !drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't reply to this comment." })
  // Replies share the comment limit: a thread is no way around it.
  await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  if (!input.body && !images.length) throw new HTTPError({ status: 400, statusText: "Write a reply." })
  const author = authorOf(who, who?.name ?? "Guest")
  // The images go where the comment's own would.
  const { row, attachments } = await withImages(
    images.length ? await imageParent(drop) : null,
    images,
    author.name ?? "Guest",
    (ids) => replyTo(thread, author, input.body, { actor: actorOf(who), mentions: input.mentions, attachments: ids }),
    (added) => ({ commentId: thread.messages[0]!.id, replyId: added.id }),
  )
  return toReply(row, who, new Map(attachments.map((file) => [file.id, file])))
})
