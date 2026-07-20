import type { RateLimitRequestEvent } from "vite-hub/rate-limit"

declare const __DROP_RATE_LIMITED__: boolean

export async function enforceUploadRateLimit(event: unknown) {
  if (!__DROP_RATE_LIMITED__) return

  const { requireRateLimit } = await import("vite-hub/rate-limit")
  await requireRateLimit(event as RateLimitRequestEvent, "image-upload", {
    failure: "deny",
    limit: 5,
    window: "1m",
  })
}
