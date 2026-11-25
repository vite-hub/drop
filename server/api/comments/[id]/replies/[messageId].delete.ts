import { defineHandler, HTTPError } from "h3"
import { findReply, readerOf, removeReply, wroteMessage } from "../../../../utils/comments"
import { findDrop, permissions } from "../../../../utils/drops"
import { identify } from "../../../../utils/identity"
import { logDrop } from "../../../../utils/logs"
import { routeMessage } from "../../../../utils/params"

export default defineHandler(async (event) => {
  const { id, messageId } = await routeMessage(event)
  const found = await findReply(messageId)
  const drop = found ? await findDrop(found.thread.meta.dropId) : null
  const who = await identify(event)
  if (
    !found ||
    found.thread.id !== id ||
    !drop ||
    !(permissions(drop, who).manage || wroteMessage(found.reply, readerOf(who)))
  )
    throw new HTTPError({ status: 404, statusText: "No reply with that id." })
  await removeReply(found.reply)
  logDrop(event, drop, { change: "reply-delete" })
  return { ok: true }
})
