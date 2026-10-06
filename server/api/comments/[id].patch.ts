import { eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { CommentPatchSchema } from "#shared/schemas"
import { comments } from "../../databases/config"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Resolve or reopen: the drop's managers, or the comment's author. */
export default defineValidatedHandler({
  validate: { body: CommentPatchSchema },
  async handler(event) {
    const [comment] = await db.select().from(comments).where(eq(comments.id, await routeId(event))).limit(1)
    const drop = comment ? await findDrop(comment.dropId) : null
    const who = await identify(event)
    if (!comment || !drop || !(permissions(drop, who).manage || (who && comment.authorId === who.userId)))
      throw new HTTPError({ status: 404, statusText: "No comment with that id." })
    const { resolved } = await event.req.json()
    await db.update(comments).set({ resolved }).where(eq(comments.id, comment.id))
    return { ok: true }
  },
})
