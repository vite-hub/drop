import { defineHandler, HTTPError } from "h3"
import { findDropAt, permissions } from "../../../../utils/drops"
import { readBoard } from "../../../../utils/boards"
import { identify } from "../../../../utils/identity"
import { routeId } from "../../../../utils/params"

/**
 * A board's Excalidraw scene, of its latest version or the one `?v=<n>` names, and whether this person may draw on it:
 * only on the latest version, like live editing.
 */
export default defineHandler(async (event) => {
  const version = Number(event.url.searchParams.get("v")) || undefined
  const drop = await findDropAt(await routeId(event), version, event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No such board." })
  return {
    snapshot: await readBoard(drop),
    canEdit: !drop.head && !drop.expired && permissions(drop, who).edit,
    updatedAt: drop.updatedAt,
  }
})
