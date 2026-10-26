import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { attachImages, imageParent, readCommentBody, withImages } from "../../../utils/comment-images"
import { authorOf, findThread, replyTo, toReply, undoReply } from "../../../utils/comments"
import { findDrop, findDropByLink, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Reply in a comment's thread: anyone who may comment on the drop, like a new comment. Images as for a comment. */
export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  // Open comments carry over to later versions, so a thread may hang off an old one: ask the latest version.
  const written = thread ? await findDrop(thread.meta.dropId, event) : null
  const drop = written?.link ? ((await findDropByLink(written.link, undefined, event)) ?? written) : written
  const who = await identify(event)
  if (!thread || !written || !drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't reply to this comment." })
  // Replies share the comment limit: a thread is no way around it.
  await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  // The images go where the comment's own would: under the version it was written on.
  const parent = images.length ? await imageParent(written) : written
  const { row, attachments } = await withImages(
    images,
    () => replyTo(thread, authorOf(who, who?.name ?? "Guest"), input.body),
    (added) =>
      attachImages(
        parent,
        images,
        { commentId: thread.comments[0]!.id, replyId: added.id, n: thread.number },
        added.author.name,
      ),
    undoReply,
  )
  return toReply(row, who, new Map([[row.id, attachments]]))
})
