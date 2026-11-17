import { defineHandler, HTTPError, noContent } from "h3"
import { findDrop, permissions, setPinned } from "../../../utils/drops"
import { isAttachment } from "../../../utils/nodes"
import { requireIdentity } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Pins a drop you can open, for your Pinned view. Only for you: nobody else sees your pins. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const drop = await findDrop(await routeId(event), event)
  if (!drop || !permissions(drop, who).view || isAttachment(drop))
    throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  await setPinned(drop.id, who, true)
  return noContent()
})
