import { defineValidatedHandler, HTTPError } from "h3"
import { CommentPatchSchema } from "#shared/schemas"
import { findThread, setResolved, wroteThread } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Resolve or reopen: the drop's managers, or the comment's author. */
export default defineValidatedHandler({
  validate: { body: CommentPatchSchema },
  async handler(event) {
    const thread = await findThread(await routeId(event))
    const drop = thread ? await findDrop(thread.meta.dropId) : null
    const who = await identify(event)
    if (!thread || !drop || !(permissions(drop, who).manage || wroteThread(thread, who)))
      throw new HTTPError({ status: 404, statusText: "No comment with that id." })
    const { resolved } = await event.req.json()
    await setResolved(thread, resolved, who)
    return { ok: true }
  },
})
