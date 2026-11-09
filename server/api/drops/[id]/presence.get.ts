import { defineHandler, HTTPError } from "h3"
import { findDrop } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { PRESENCE, presenceRoom } from "../../../utils/presence"
import { openable } from "../../../utils/review"

/**
 * The name of a drop's presence room (server/realtime/presence.ts), for people who could open the drop without its
 * link. Everyone else, a stranger on a public link included, gets a 404 and never joins, so they never see who else
 * is reading.
 */
export default defineHandler(async (event) => {
  const [drop, who] = await Promise.all([findDrop(await routeId(event), event), identify(event)])
  if (!PRESENCE || !drop || who?.actorKind !== "browser" || !openable(drop, who))
    throw new HTTPError({ status: 404, statusText: "No presence for this drop." })
  event.res.headers.set("Cache-Control", "private, no-store")
  return { room: await presenceRoom(event, drop) }
})
