import { defineHandler, getRouterParam, HTTPError } from "h3"
import { dropDetail, findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"

/** Owners, editors, admins, and anyone the drop is shared with. Private drops 404 for everyone else. */
export default defineHandler(async (event) => {
  const drop = await findDrop(getRouterParam(event, "id") ?? "")
  const who = await identify(event)
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  event.res.headers.set("Cache-Control", "private, no-store")
  return dropDetail(drop, who, event.url.origin)
})
