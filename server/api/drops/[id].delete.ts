import { defineHandler, HTTPError } from "h3"
import { deleteDrop, findDrop, permissions } from "../../utils/drops"
import { updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { isAttachment } from "../../utils/nodes"
import { routeId } from "../../utils/params"

/** Moves a drop to the Trash, and a folder with everything in it. `?forever` deletes it now; only people can, never their agents. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const drop = await findDrop(await routeId(event), event)
  if (!drop || isAttachment(drop) || !(permissions(drop, who).owner || who.role === "admin")) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (!event.url.searchParams.has("forever")) return updateDrop(drop, who, { trashed: true }, event)
  if (who.actorKind !== "browser") throw new HTTPError({ status: 403, statusText: "Only people can delete a drop for good. Move it to the Trash instead." })
  await deleteDrop(drop)
  return { ok: true }
})
