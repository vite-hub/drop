import type { H3Event } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"

/** REST and MCP share one owner bucket, separate from monthly usage accounting. */
export async function requirePublishBurst(event: H3Event, ownerId: string) {
  await requireRateLimit(event, "file-upload", { key: ownerId, limit: 30, window: "1m" })
}
