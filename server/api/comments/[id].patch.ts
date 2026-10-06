import { eq } from "drizzle-orm"
import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { comments } from "../../databases/config"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"

/** Resolve or reopen: the drop's managers, or the comment's author. */
export default defineHandler(async (event) => {
  const [comment] = await db.select().from(comments).where(eq(comments.id, getRouterParam(event, "id") ?? "")).limit(1)
  const drop = comment ? await findDrop(comment.dropId) : null
  const who = await identify(event)
  if (!comment || !drop || !(permissions(drop, who).manage || (who && comment.authorId === who.userId)))
    throw new HTTPError({ status: 404, statusText: "No comment with that id." })
  const { resolved } = await readValidatedBody(event, v.object({ resolved: v.boolean() }))
  await db.update(comments).set({ resolved }).where(eq(comments.id, comment.id))
  return { ok: true }
})
