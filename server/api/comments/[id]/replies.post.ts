import { eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentReplySchema } from "#shared/schemas"
import { comments } from "../../../databases/config"
import { addReply } from "../../../utils/comments"
import { findDrop, findDropByLink, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Reply in a comment's thread: anyone who may comment on the drop, like a new comment. */
export default defineValidatedHandler({
  validate: { body: CommentReplySchema },
  async handler(event) {
    const [comment] = await db.select().from(comments).where(eq(comments.id, await routeId(event))).limit(1)
    // Open comments carry over to later versions, so a thread may hang off an old one: ask the latest version.
    const written = comment ? await findDrop(comment.dropId, event) : null
    const drop = written?.link ? await findDropByLink(written.link, undefined, event) ?? written : written
    const who = await identify(event)
    if (!comment || !drop || !permissions(drop, who).comment) throw new HTTPError({ status: 404, statusText: "You can't reply to this comment." })
    // Replies share the comment limit: a thread is no way around it.
    await requireRateLimit(event, "comment", { key: who?.userId, limit: 20, window: "1m" })
    const { body } = await event.req.json()
    return addReply(comment, who, body)
  },
})
