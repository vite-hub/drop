import type evlog from "evlog/nitro/v3"

type EvlogOptions = NonNullable<Parameters<typeof evlog>[0]>

/**
 * Drop's evlog options (nuxt.config.ts). evlog passes them to the server as JSON, so they hold no functions or RegExps;
 * the scrubbing that needs either runs in server/plugins/wide-events.ts.
 */
export function evlogOptions(release: { version: string; commit: string }): EvlogOptions {
  return {
    // Every event names the release it came from: package.json's version and the commit the host built.
    env: { service: "drop", version: release.version, ...(release.commit ? { commitHash: release.commit } : {}) },
    // Files that never fail on their own, and the Docker health check every 30 s.
    exclude: [
      "/_drop-ui/**",
      "/_fonts/**",
      "/_nuxt/**",
      "/vendor/**",
      "/agents/**",
      "/docs/features/**",
      "/favicon.svg",
      "/favicon.ico",
      "/apple-touch-icon.png",
      "/icon.png",
      "/og.png",
      "/logo-dark.svg",
      "/logo-light.svg",
      "/document-zoom.js",
      "/__nuxt_error",
      "/api/health",
    ],
    redact: { paths: ["**.key", "**.secret", "**.password"] },
    // Every event is kept today. These keep failures, slow requests, and audits (evlog keeps those itself) when a
    // lower rate is set later.
    sampling: { rates: { info: 100, warn: 100, debug: 100, error: 100 }, keep: [{ status: 400 }, { duration: 1000 }] },
  }
}
