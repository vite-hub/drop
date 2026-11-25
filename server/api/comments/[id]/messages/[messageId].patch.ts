import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CommentEditSchema } from "#shared/schemas"
import { editMessage, findMessage, toReply, TOO_MANY_COMMENTS, wroteMessage } from "../../../../utils/comments"
import { findDrop, permissions } from "../../../../utils/drops"
import { identify } from "../../../../utils/identity"
import { logDrop } from "../../../../utils/logs"
import { routeMessage } from "../../../../utils/params"

export default defineValidatedHandler({
  validate: { body: CommentEditSchema },
  async handler(event) {
    const { id, messageId } = await routeMessage(event)
    const found = await findMessage(messageId)
    const drop = found ? await findDrop(found.thread.meta.dropId, event) : null
    const who = await identify(event)
    if (
      !found ||
      found.thread.id !== id ||
      !drop ||
      !who ||
      !wroteMessage(found.message, who.userId) ||
      !permissions(drop, who).comment
    )
      throw new HTTPError({ status: 404, statusText: "You can't edit this comment." })
    await requireRateLimit(event, "comment", { key: who.userId, limit: 20, window: "1m", message: TOO_MANY_COMMENTS })
    const { body, mentions } = await event.req.json()
    const edited = await editMessage(found.message, body, mentions)
    logDrop(event, drop, { change: "comment-edit" })
    return toReply(edited, who.userId, new Map())
  },
})
