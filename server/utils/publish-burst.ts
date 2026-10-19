import { HTTPError, type H3Event } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"

/** Must match the literal below: ViteHub reads rate-limit policies from the source at build time. */
export const PUBLISH_BURST = 30

/** REST and MCP share one owner bucket, separate from monthly usage accounting. */
export async function requirePublishBurst(event: H3Event, ownerId: string) {
  try {
    await requireRateLimit(event, "file-upload", { key: ownerId, limit: 30, window: "1m" })
  }
  catch (error) {
    if (HTTPError.isError(error)) throw error
    if (error instanceof Error && "status" in error && error.status === 429)
      throw new HTTPError({ status: 429, headers: "headers" in error && error.headers instanceof Headers ? error.headers : undefined, cause: error })
    throw error
  }
}
