import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { encodeInk } from "#shared/ink"
import { CommentSchema } from "#shared/schemas"
import { clientAddress } from "../../../utils/client-address"
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
  addThread,
  authorOf,
  earlierThread,
  mentionedIn,
  readerOf,
  toComment,
  TOO_MANY_COMMENTS,
} from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const version = Number(event.url.searchParams.get("v")) || undefined
  const drop = await findDropAt(await routeId(event), version, event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).comment)
    return refuseSend(event, who, new HTTPError({ status: 404, statusText: "You can't comment on this drop." }))
  await requireRateLimit(event, "comment", {
    key: who?.userId ?? clientAddress(event),
    limit: 20,
    window: "1m",
    message: TOO_MANY_COMMENTS,
  })
  const { input, images } = await readCommentBody(event, CommentSchema)
  requireSender(who, input.as)
  if (!input.body && !images.length && input.suggestion === undefined)
    throw new HTTPError({ status: 400, statusText: "Write a comment." })
  const guest = who ? null : await guestOf(event, { mint: true })
  const author = authorOf(who, who?.name ?? "Guest", guest)
  const reader = readerOf(who, guest)
  const { body, quote, label, page, mentions, ink, requestId, as: _sender, ...anchor } = input
  const earlier = requestId ? await earlierThread(drop, requestId, author, guest ?? (await guestOf(event))) : null
  if (earlier)
    return toComment(
      earlier,
      reader,
      await attachmentsById(earlier.messages[0]?.attachments ?? []),
      await mentionedIn([earlier]),
    )
  const { row, attachments } = await withImages(
    images.length ? await imageParent(drop) : null,
    images,
    author.name ?? "Guest",
    (ids) =>
      addThread(drop, {
        fields: {
          ...anchor,
          quote: quote ?? null,
          ink: ink ? encodeInk(ink) : null,
          label: label ?? null,
          page: page ?? null,
          elementX: null,
          elementY: null,
        },
        body,
        author,
        actor: actorOf(who),
        mentions,
        attachments: ids,
        ...(requestId ? { requestId } : {}),
      }),
    (added, ids) => (lists(added.messages[0], ids) ? { commentId: added.messages[0]!.id, replyId: null } : null),
  )
  logDrop(event, drop, { change: "comment" })
  const files = attachments
    ? new Map(attachments.map((file) => [file.id, file]))
    : await attachmentsById(row.messages[0]?.attachments ?? [])
  return toComment(row, reader, files, await mentionedIn([row]))
})
