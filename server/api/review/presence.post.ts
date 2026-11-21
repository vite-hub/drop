import { HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { PRESENCE, presenceRoom, presenceTicket } from "../../utils/presence"
import { openable, reviewApi, reviewSession } from "../../utils/review"

export default reviewApi(async (event) => {
  const { site, claims, who } = await reviewSession(event)
  if (!PRESENCE || !who || !openable(site, who))
    throw new HTTPError({ status: 404, statusText: "Only people the review is shared with see who else is here." })
  await requireRateLimit(event, "review-presence", { key: who.userId, limit: 30, window: "1m" })
  const issued = await presenceTicket(event, claims)
  if (!issued) throw new HTTPError({ status: 404, statusText: "Guests don't see who else is here." })
  const you = { id: who.userId, name: who.name, ...(who.image ? { image: who.image } : {}) }
  return { room: await presenceRoom(event, site), you, ...issued }
})
