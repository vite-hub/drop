import { defineHandler, HTTPError } from "h3"
import { contentOrigin } from "../../utils/content-origin"
import { dropDetail, expiredLink, findDrop, permissions, recordSharedVisit, waitingForReview } from "../../utils/drops"
import { recordVisit } from "../../utils/expiry"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Owners, editors, admins, and anyone the drop is shared with. Private drops 404 for everyone else. */
export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (waitingForReview(drop, who))
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (expiredLink(drop, who))
    throw new HTTPError({ status: 410, statusText: "This drop expired after nobody opened it for a while." })
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  event.res.headers.set("Cache-Control", "private, no-store")
  // Signed-in people and agents count here; anonymous visitors count through the page's visit beacon.
  if (who) await Promise.all([recordVisit(event, drop, who, "beacon"), recordSharedVisit(drop, who)])
  const detail = await dropDetail(drop, who, event.url.origin, event)
  const frameOrigin = detail.kind === "app" || detail.kind === "html" ? contentOrigin(event, drop.id) : null
  return frameOrigin ? { ...detail, contentOrigin: frameOrigin } : detail
})
