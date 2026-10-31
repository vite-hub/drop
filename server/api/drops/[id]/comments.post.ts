import { eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentSchema } from "#shared/schemas"
import { comments } from "../../../databases/config"
import { attachImages, imageParent, readCommentBody, withImages } from "../../../utils/comment-images"
import { authorImages, nextCommentNumber, toComment } from "../../../utils/comments"
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
  const { input: body, images } = await readCommentBody(event, CommentSchema)
  if (!body.body && !images.length && body.suggestion === undefined)
    throw new HTTPError({ status: 400, statusText: "Write a comment." })
  const parent = images.length ? await imageParent(drop) : drop
  const authorName = who?.name ?? "Guest"
  const { row, attachments } = await withImages(
    images,
    async () => {
      // The next number comes from the same statement as the insert, so two comments can't take the same one.
      const [inserted] = await db
        .insert(comments)
        .values({
          id: crypto.randomUUID(),
          dropId: drop.id,
          version: drop.version,
          n: nextCommentNumber(drop),
          ...body,
          quote: body.quote ?? null,
          suggestion: body.suggestion ?? null,
          label: body.label ?? null,
          page: body.page ?? null,
          authorId: who?.userId ?? null,
          authorName,
          resolved: false,
          createdAt: Date.now(),
        })
        .returning()
      return inserted!
    },
    (added) => attachImages(parent, images, { commentId: added.id, replyId: null, n: added.n }, authorName),
    (added) => db.delete(comments).where(eq(comments.id, added.id)),
  )
  return toComment(row, who, {
    images: await authorImages([row]),
    replies: new Map(),
    attachments: new Map([[row.id, attachments]]),
  })
})
