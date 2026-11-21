import { type H3Event, HTTPError } from "h3"
import { checkRateLimit } from "vite-hub/rate-limit"

export const PUBLISH_BURST = 30

export async function publishBurst(event: H3Event, ownerId: string) {
  const [error, decision] = await checkRateLimit(event, "file-upload", {
    key: ownerId,
    limit: PUBLISH_BURST,
    window: "1m",
  })
  if (error) throw new HTTPError({ status: 503, statusText: "Rate limiting is unavailable.", cause: error })
  return decision
}
