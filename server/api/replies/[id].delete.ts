import { defineHandler, HTTPError } from "h3"
import { findReply, removeReply, wroteComment } from "../../utils/comments"
import { findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** A reply goes with its author's say, or the drop's managers', like a comment. */
export default defineHandler(async (event) => {
  const found = await findReply(await routeId(event))
  const drop = found ? await findDrop(found.thread.meta.dropId) : null
  const who = await identify(event)
  if (!found || !drop || !(permissions(drop, who).manage || wroteComment(found.reply, who)))
    throw new HTTPError({ status: 404, statusText: "No reply with that id." })
  await removeReply(found.reply)
  return { ok: true }
})
