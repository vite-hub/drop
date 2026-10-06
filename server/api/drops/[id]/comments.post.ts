import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { comments } from "../../../databases/config"
import { requireRateLimit } from "vite-hub/rate-limit"
import { listComments, toComment } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"

const Body = v.object({
  kind: v.picklist(["text", "image"]),
  selector: v.pipe(v.string(), v.maxLength(2000)),
  ox: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  oy: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  quote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  label: v.optional(v.pipe(v.string(), v.maxLength(200))),
  page: v.optional(v.pipe(v.string(), v.maxLength(300))),
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
})

/** Anyone allowed to comment, including people on a "Can comment" link who aren't signed in. */
export default defineHandler(async (event) => {
  const drop = await findDrop(getRouterParam(event, "id") ?? "")
  const who = await identify(event)
  if (!drop || !permissions(drop, who).comment) throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
  // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
  if (!import.meta.dev) await requireRateLimit(event, "comment", { failure: "deny", key: who?.userId, limit: 20, window: "1m" })
  const body = await readValidatedBody(event, Body)
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
})
