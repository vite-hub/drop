import { defineValidatedHandler, HTTPError } from "h3"
import * as v from "valibot"
import { deleteDrop, findDrop, permissions } from "../../utils/drops"
import { updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { isAttachment } from "../../utils/nodes"
import { routeId } from "../../utils/params"

/**
 * Moves a drop to the Trash, and a folder with everything in it; anyone on the team may for a drop in a team folder.
 * `?forever` deletes it now: its owner or an admin, people only, never their agents.
 */
export default defineValidatedHandler({
  validate: { query: v.object({ forever: v.optional(v.string()) }) },
  async handler(event) {
  const who = await requireIdentity(event)
  const drop = await findDrop(await routeId(event), event)
  const forever = event.url.searchParams.has("forever")
  const can = drop && permissions(drop, who)
  if (!drop || !can || isAttachment(drop) || !(forever ? can.manage : can.trash)) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (!forever) return updateDrop(drop, who, { trashed: true }, event)
  if (who.actorKind !== "browser") throw new HTTPError({ status: 403, statusText: "Only people can delete a drop for good. Move it to the Trash instead." })
  await deleteDrop(drop)
  return { ok: true }
  },
})
