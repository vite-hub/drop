import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentSchema } from "#shared/schemas"
import { comments } from "../../../databases/config"
import { listComments, toComment } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Anyone allowed to comment, including people on a "Can comment" link who aren't signed in. */
export default defineValidatedHandler({
  validate: { body: CommentSchema },
  async handler(event) {
    const drop = await findDrop(await routeId(event))
    const who = await identify(event)
    if (!drop || !permissions(drop, who).comment) throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
    // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
    if (!import.meta.dev) await requireRateLimit(event, "comment", { failure: "deny", key: who?.userId, limit: 20, window: "1m" })
    const body = await event.req.json()
    const existing = await listComments(drop.id)
    const row = {
      id: crypto.randomUUID(),
      dropId: drop.id,
      n: (existing.at(-1)?.n ?? 0) + 1,
      ...body,
      quote: body.quote ?? null,
      label: body.label ?? null,
      page: body.page ?? null,
      authorId: who?.userId ?? null,
      authorName: who?.name ?? "Guest",
      resolved: false,
      createdAt: Date.now(),
    }
    await db.insert(comments).values(row)
    return toComment(row, who)
  },
})
