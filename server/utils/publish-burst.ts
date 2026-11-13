import type { H3Event } from "h3"
import { checkRateLimit } from "vite-hub/rate-limit"

/** Must match the literal below: ViteHub reads rate-limit policies from the source at build time. */
export const PUBLISH_BURST = 30

/** REST and MCP share one owner bucket, separate from monthly usage accounting. */
export async function publishBurst(event: H3Event, ownerId: string) {
  const [error, decision] = await checkRateLimit(event, "file-upload", { key: ownerId, limit: 30, window: "1m" })
  if (error) throw error
  return decision
}
