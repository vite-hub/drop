import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentSchema } from "#shared/schemas"
import { comments } from "../../../databases/config"
import { authorImages, nextCommentNumber, toComment } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Anyone allowed to comment, including people on a "Can comment" link who aren't signed in. */
export default defineValidatedHandler({
  validate: { body: CommentSchema },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || !permissions(drop, who).comment) throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
    // Cloudflare Rate Limiting on Workers, ViteHub's in-memory limiter elsewhere (local dev included).
    await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
    const body = await event.req.json()
    // The next number comes from the same statement as the insert, so two comments can't take the same one.
    const [row] = await db.insert(comments).values({
      id: crypto.randomUUID(),
      dropId: drop.id,
      n: nextCommentNumber(drop),
      ...body,
      quote: body.quote ?? null,
      label: body.label ?? null,
      page: body.page ?? null,
      authorId: who?.userId ?? null,
      authorName: who?.name ?? "Guest",
      resolved: false,
      createdAt: Date.now(),
    }).returning()
    return toComment(row!, who, drop.version, { images: await authorImages([row!]), replies: new Map() })
  },
})
