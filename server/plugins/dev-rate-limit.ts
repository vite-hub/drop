import { definePlugin } from "nitro"
import { setRateLimitRuntimeConfig } from "vite-hub/_internal/rate-limit/runtime"

/**
 * `nuxt dev` limits in memory. ViteHub sets the Cloudflare provider even when serving, and the local Workers emulation
 * has no Rate Limiting bindings, so every limited route (uploads, comments, reports) failed with a 500. Runs after
 * ViteHub's own plugin, which installs its config first.
 */
export default definePlugin(() => {
  if (import.meta.dev) setRateLimitRuntimeConfig({ provider: "memory" })
})
