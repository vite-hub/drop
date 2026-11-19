import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { encodeInk } from "#shared/ink"
import { CommentSchema } from "#shared/schemas"
import { attachmentsById, imageParent, lists, readCommentBody, withImages } from "../../../utils/comment-images"
import {
  actorOf,
  addThread,
  authorOf,
  earlierThread,
  mentionedIn,
  readerOf,
  toComment,
  withRetryAfter,
} from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { routeId } from "../../../utils/params"

/**
 * Anyone allowed to comment, including people on a "Can comment" link who aren't signed in. JSON, or multipart with
 * the JSON in `data` and images in `image` (see readCommentBody). `?v=<n>` is the version it's written on. A resend
 * with the same `requestId` answers the comment the first one added, without storing its images again.
 */
export default defineHandler(async (event) => {
  const version = Number(event.url.searchParams.get("v")) || undefined
  const drop = await findDropAt(await routeId(event), version, event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
  // Cloudflare Rate Limiting on Workers, ViteHub's in-memory limiter elsewhere (local dev included).
  await withRetryAfter(requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" }))
  const { input, images } = await readCommentBody(event, CommentSchema)
  if (!input.body && !images.length && input.suggestion === undefined)
    throw new HTTPError({ status: 400, statusText: "Write a comment." })
  const guest = who ? null : await guestOf(event, { mint: true })
  const author = authorOf(who, who?.name ?? "Guest", guest)
  const reader = readerOf(who, guest)
  const { body, quote, label, page, mentions, ink, requestId, ...anchor } = input
  const earlier = requestId ? await earlierThread(drop, requestId, author) : null
  if (earlier)
    return toComment(
      earlier,
      reader,
      await attachmentsById(earlier.messages[0]?.attachments ?? []),
      await mentionedIn([earlier]),
    )
  // Comments numbers the thread in the same statement that adds it, so two comments can't take the same number.
  const { row, attachments } = await withImages(
    images.length ? await imageParent(drop) : null,
    images,
    author.name ?? "Guest",
    (ids) =>
      addThread(drop, {
        fields: {
          ...anchor,
          quote: quote ?? null,
          // Too detailed to keep even simplified: the comment keeps its box and its picture.
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
    // A resend that overlapped the first one gets the first one's thread, which lists that one's images.
    (added, ids) => (lists(added.messages[0], ids) ? { commentId: added.messages[0]!.id, replyId: null } : null),
  )
  logDrop(event, drop, { change: "comment" })
  const files = attachments
    ? new Map(attachments.map((file) => [file.id, file]))
    : await attachmentsById(row.messages[0]?.attachments ?? [])
  return toComment(row, reader, files, await mentionedIn([row]))
})
