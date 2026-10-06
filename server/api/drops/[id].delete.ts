import { defineHandler, getRouterParam, HTTPError } from "h3"
import { deleteDrop, findDrop, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const drop = await findDrop(getRouterParam(event, "id") ?? "")
  if (!drop || !(permissions(drop, who).owner || who.role === "admin")) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  await deleteDrop(drop)
  return { ok: true }
})
