import { defineHandler, HTTPError } from "h3"
import { findThread, removeThread, wroteThread } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId) : null
  const who = await identify(event)
  if (!thread || !drop || !(permissions(drop, who).manage || wroteThread(thread, who)))
    throw new HTTPError({ status: 404, statusText: "No comment with that id." })
  await removeThread(thread)
  logDrop(event, drop, { change: "comment-delete" })
  return { ok: true }
})
