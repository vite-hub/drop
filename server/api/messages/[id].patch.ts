import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentEditSchema } from "#shared/schemas"
import { editMessage, findMessage, toReply, wroteMessage } from "../../utils/comments"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/**
 * New words for a comment or a reply (by its message id), from the person who wrote it, while they may still comment
 * on the drop. Its images stay. A guest's words can't be edited: their id is no proof of who they are.
 */
export default defineValidatedHandler({
  validate: { body: CommentEditSchema },
  async handler(event) {
    const found = await findMessage(await routeId(event))
    const drop = found ? await findDrop(found.thread.meta.dropId, event) : null
    const who = await identify(event)
    if (!found || !drop || !who || !wroteMessage(found.message, who) || !permissions(drop, who).comment)
      throw new HTTPError({ status: 404, statusText: "You can't edit this comment." })
    await requireRateLimit(event, "comment", { key: who.userId, limit: 20, window: "1m" })
    const { body, mentions } = await event.req.json()
    const edited = await editMessage(found.message, body, mentions)
    return toReply(edited, who, new Map())
  },
})
