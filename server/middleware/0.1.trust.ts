import { defineHandler, HTTPError } from "h3"

export default defineHandler(async (event) => {
  const path = event.url.pathname
  if (path.startsWith("/f/") || path.startsWith("/d/")) {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow")
    event.res.headers.set("Cache-Control", "private, no-store")
  }
  if (path.replace(/\/+$/, "") !== "/api/auth/oauth2/register" || event.req.method !== "POST") return
  const { requireRateLimit } = await import("vite-hub/rate-limit")
  if (!import.meta.dev) await requireRateLimit(event, "oauth-register", { failure: "deny", limit: 10, window: "1m" })
  const reader = event.req.clone().body?.getReader()
  let bytes = 0
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 16_384) {
          void event.req.body?.cancel().catch(() => {})
          throw new HTTPError({ status: 413, statusText: "Client metadata is too large." })
        }
      }
    }
    finally { void reader.cancel().catch(() => {}) }
  }
})
