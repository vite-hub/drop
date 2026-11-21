import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import {
  attachmentsById,
  imageParent,
  lists,
  readCommentBody,
  refuseSend,
  requireSender,
  withImages,
} from "../../../utils/comment-images"
import {
  actorOf,
  authorOf,
  earlierReply,
  findThread,
  readerOf,
  replyTo,
  toReply,
  TOO_MANY_COMMENTS,
} from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId, event) : null
  const who = await identify(event)
  if (!thread || !drop || !permissions(drop, who).comment)
    return refuseSend(event, who, new HTTPError({ status: 404, statusText: "You can't reply to this comment." }))
  await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m", message: TOO_MANY_COMMENTS })
  const { input, images } = await readCommentBody(event, CommentReplySchema)
  requireSender(who, input.as)
  if (!input.body && !images.length) throw new HTTPError({ status: 400, statusText: "Write a reply." })
  const guest = who ? null : await guestOf(event, { mint: true })
  const author = authorOf(who, who?.name ?? "Guest", guest)
  const reader = readerOf(who, guest)
  const earlier = input.requestId
    ? await earlierReply(thread, input.requestId, author, guest ?? (await guestOf(event)))
    : null
  if (earlier) return toReply(earlier, reader, await attachmentsById(earlier.attachments))
  const { row, attachments } = await withImages(
    images.length ? await imageParent(drop) : null,
    images,
    author.name ?? "Guest",
    (ids) =>
      replyTo(thread, author, input.body, {
        actor: actorOf(who),
        mentions: input.mentions,
        attachments: ids,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      }),
    (added, ids) => (lists(added, ids) ? { commentId: thread.messages[0]!.id, replyId: added.id } : null),
  )
  logDrop(event, drop, { change: "reply" })
  const files = attachments
    ? new Map(attachments.map((file) => [file.id, file]))
    : await attachmentsById(row.attachments)
  return toReply(row, reader, files)
})
