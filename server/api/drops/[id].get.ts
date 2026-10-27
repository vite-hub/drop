import { defineHandler, HTTPError } from "h3"
import { appFilesGrant } from "../../utils/app-files"
import { contentOrigin, perDropOrigins } from "../../utils/content-origin"
import {
  dropDetail,
  expiredLink,
  findDropAt,
  permissions,
  recordSharedVisit,
  waitingForReview,
} from "../../utils/drops"
import { recordVisit } from "../../utils/expiry"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"
import { countView } from "../../utils/views"

/**
 * Owners, editors, admins, and anyone the drop is shared with. Private drops 404 for everyone else. `?v=<n>` reads an
 * earlier version.
 */
export default defineHandler(async (event) => {
  const id = await routeId(event)
  const version = Number(event.url.searchParams.get("v")) || undefined
  const [drop, who] = await Promise.all([findDropAt(id, version, event), identify(event)])
  if (waitingForReview(drop, who))
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (expiredLink(drop, who))
    throw new HTTPError({ status: 410, statusText: "This drop expired after nobody opened it for a while." })
  if (!drop || !permissions(drop, who).view)
    throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  event.res.headers.set("Cache-Control", "private, no-store")
  // Signed-in people and agents count here; anonymous visitors count through the page's visit beacon. The writes go
  // alongside the reads below rather than before them.
  const visited = who
    ? Promise.all([
        recordVisit(event, drop, who, "beacon"),
        countView(event, drop, who, "beacon"),
        recordSharedVisit(drop, who),
      ])
    : undefined
  // Named after the drop, so every version of an HTML doc keeps the browser storage the last one left.
  const frameOrigin = drop.kind === "app" || drop.kind === "html" ? await contentOrigin(event, drop.id) : null
  // An app on its own origin loads its files from there, so the viewer needs only its pages, and a grant to the rest.
  const served = drop.kind === "app" && !!frameOrigin && perDropOrigins(event)
  const [detail] = await Promise.all([
    dropDetail(drop, who, event.url.origin, event, served ? "pages" : "all"),
    visited,
  ])
  if (!frameOrigin) return detail
  return {
    ...detail,
    contentOrigin: frameOrigin,
    ...(served ? { contentGrant: await appFilesGrant(event, drop.id) } : {}),
  }
})
