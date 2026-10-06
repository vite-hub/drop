import { eq } from "drizzle-orm"
import { defineHandler, getRouterParam, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { comments } from "../../databases/config"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"

export default defineHandler(async (event) => {
  const [comment] = await db.select().from(comments).where(eq(comments.id, getRouterParam(event, "id") ?? "")).limit(1)
  const drop = comment ? await findDrop(comment.dropId) : null
  const who = await identify(event)
  if (!comment || !drop || !(permissions(drop, who).manage || (who && comment.authorId === who.userId)))
    throw new HTTPError({ status: 404, statusText: "No comment with that id." })
  await db.delete(comments).where(eq(comments.id, comment.id))
  return { ok: true }
})
