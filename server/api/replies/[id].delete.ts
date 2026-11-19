import { defineHandler, HTTPError } from "h3"
import { findReply, readerOf, removeReply, wroteMessage } from "../../utils/comments"
import { findDrop, permissions } from "../../utils/drops"
import { guestOf } from "../../utils/guests"
import { identify } from "../../utils/identity"
import { logDrop } from "../../utils/logs"
import { routeId } from "../../utils/params"

/** A reply goes with its author's say, or the drop's managers', like a comment. */
export default defineHandler(async (event) => {
  const found = await findReply(await routeId(event))
  const drop = found ? await findDrop(found.thread.meta.dropId) : null
  const who = await identify(event)
  const reader = readerOf(who, who ? null : await guestOf(event))
  if (!found || !drop || !(permissions(drop, who).manage || wroteMessage(found.reply, reader)))
    throw new HTTPError({ status: 404, statusText: "No reply with that id." })
  await removeReply(found.reply)
  logDrop(event, drop, { change: "reply-delete" })
  return { ok: true }
})
