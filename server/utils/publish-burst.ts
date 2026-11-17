import { type H3Event, HTTPError } from "h3"
import { checkRateLimit } from "vite-hub/rate-limit"

export const PUBLISH_BURST = 30

/** REST and MCP share one owner bucket, separate from monthly usage accounting. */
export async function publishBurst(event: H3Event, ownerId: string) {
  const [error, decision] = await checkRateLimit(event, "file-upload", {
    key: ownerId,
    limit: PUBLISH_BURST,
    window: "1m",
  })
  // The host's limiter binding is missing: fail closed, as an unavailable limiter does.
  if (error) throw new HTTPError({ status: 503, statusText: "Rate limiting is unavailable.", cause: error })
  return decision
}
