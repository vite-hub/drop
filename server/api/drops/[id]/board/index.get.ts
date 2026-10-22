import { defineHandler, HTTPError } from "h3"
import { findDrop, permissions, versionsOf } from "../../../../utils/drops"
import { readBoard } from "../../../../utils/boards"
import { identify } from "../../../../utils/identity"
import { routeId } from "../../../../utils/params"

/** A board's Excalidraw scene, and whether this person may draw on it: only on the latest version, like live editing. */
export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No such board." })
  const latest = (await versionsOf(drop))[0]?.id === drop.id
  return {
    snapshot: await readBoard(drop),
    canEdit: latest && !drop.expired && permissions(drop, who).edit,
    updatedAt: drop.updatedAt,
  }
})
