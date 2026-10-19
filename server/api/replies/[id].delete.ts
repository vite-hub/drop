import { eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { commentReplies, comments } from "../../databases/config"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** A reply goes with its author's say, or the drop's managers', like a comment. */
export default defineHandler(async (event) => {
  const [found] = await db.select({ reply: commentReplies, dropId: comments.dropId }).from(commentReplies)
    .innerJoin(comments, eq(comments.id, commentReplies.commentId)).where(eq(commentReplies.id, await routeId(event))).limit(1)
  const drop = found ? await findDrop(found.dropId) : null
  const who = await identify(event)
  if (!found || !drop || !(permissions(drop, who).manage || (who && found.reply.authorId === who.userId)))
    throw new HTTPError({ status: 404, statusText: "No reply with that id." })
  await db.delete(commentReplies).where(eq(commentReplies.id, found.reply.id))
  return { ok: true }
})
