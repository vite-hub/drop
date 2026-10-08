import { defineHandler, HTTPError } from "h3"
import { dropDetail, findDrop, permissions } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Owners, editors, admins, and anyone the drop is shared with. Private drops 404 for everyone else. */
export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (drop && !drop.ownerBanned && !drop.quarantinedAt && drop.visibility === "shared" && drop.shareReview === "pending" && !permissions(drop, who).view)
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  event.res.headers.set("Cache-Control", "private, no-store")
  return dropDetail(drop, who, event.url.origin)
})
