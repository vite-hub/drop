import { defineHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentSchema } from "#shared/schemas"
import { imageParent, readCommentBody, withImages } from "../../../utils/comment-images"
import { addThread, authorOf, mentionedIn, toComment } from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/**
 * Anyone allowed to comment, including people on a "Can comment" link who aren't signed in. JSON, or multipart with
 * the JSON in `data` and images in `image` (see readCommentBody). `?v=<n>` is the version it's written on.
 */
export default defineHandler(async (event) => {
  const version = Number(event.url.searchParams.get("v")) || undefined
  const drop = await findDropAt(await routeId(event), version, event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
  // Cloudflare Rate Limiting on Workers, ViteHub's in-memory limiter elsewhere (local dev included).
  await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
  const { input, images } = await readCommentBody(event, CommentSchema)
  if (!input.body && !images.length && input.suggestion === undefined)
    throw new HTTPError({ status: 400, statusText: "Write a comment." })
  const author = authorOf(who, who?.name ?? "Guest")
  const { body, quote, label, page, mentions, ...anchor } = input
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
          label: label ?? null,
          page: page ?? null,
          elementX: null,
          elementY: null,
        },
        body,
        author,
        mentions,
        attachments: ids,
      }),
    (added) => ({ commentId: added.messages[0]!.id, replyId: null }),
  )
  return toComment(row, who, new Map(attachments.map((file) => [file.id, file])), await mentionedIn([row]))
})
