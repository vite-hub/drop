import { defineHandler, HTTPError } from "h3"

/** Dynamic client registration is open to anyone, so it's rate limited and its metadata kept small. */
export default defineHandler(async (event) => {
  if (event.url.pathname.replace(/\/+$/, "") !== "/api/auth/oauth2/register" || event.req.method !== "POST") return
  const { requireRateLimit } = await import("vite-hub/rate-limit")
  await requireRateLimit(event, "oauth-register", { limit: 10, window: "1m" })
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
    } finally {
      void reader.cancel().catch(() => {})
    }
  }
})
