import { HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { PRESENCE, presenceRoom, presenceTicket } from "../../utils/presence"
import { openable, reviewApi, reviewSession } from "../../utils/review"

/**
 * review.js trades its review token here for what it joins the review's presence room with: the room's name and a
 * short-lived ticket (server/utils/presence.ts). Only people the review is shared with get one; everyone else still
 * comments, without seeing who else is on the page.
 */
export default reviewApi(async (event) => {
  const { site, claims, who } = await reviewSession(event)
  if (!PRESENCE || !who || !openable(site, who))
    throw new HTTPError({ status: 404, statusText: "Only people the review is shared with see who else is here." })
  await requireRateLimit(event, "review-presence", { key: who.userId, limit: 30, window: "1m" })
  const issued = await presenceTicket(event, claims)
  if (!issued) throw new HTTPError({ status: 404, statusText: "Guests don't see who else is here." })
  return { room: await presenceRoom(event, site), ...issued }
})
