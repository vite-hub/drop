import { defineHandler, HTTPError } from "h3"
import { deleteDrop, findDrop, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { routeId } from "../../utils/params"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const drop = await findDrop(await routeId(event), event)
  if (!drop || !(permissions(drop, who).owner || who.role === "admin")) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  await deleteDrop(drop)
  return { ok: true }
})
