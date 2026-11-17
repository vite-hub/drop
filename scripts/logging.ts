import type evlog from "evlog/nitro/v3"

type EvlogOptions = NonNullable<Parameters<typeof evlog>[0]>

/**
 * evlog passes its options to the server as JSON, where a RegExp would become `{}`. This one becomes
 * `{ source, flags }`, which evlog's Nitro plugin compiles back into a RegExp (normalizeRedactConfig).
 */
const serializable = (pattern: RegExp) =>
  Object.assign(pattern, { toJSON: () => ({ source: pattern.source, flags: pattern.flags }) })

/**
 * Credentials in paths: an upload URL's sealed ticket (server/utils/uploads.ts) stands in for the agent's sign-in, and
 * a password reset link's token for the person's. Then IPv6 addresses: evlog's built-in redaction masks IPv4 only.
 */
const PATTERNS = [
  serializable(/(?<=\/api\/(?:uploads|auth\/reset-password)\/)[^/?#\s"]+/g),
  serializable(
    new RegExp(
      String.raw`(?<![\w:.])(?:(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|:(?::[\da-f]{1,4}){1,7})(?![\w:])`,
      "gi",
    ),
  ),
]

/**
 * Drop's evlog options (nuxt.config.ts). evlog passes them to the server as JSON, so they hold no functions, and its
 * redaction patterns serialize as `{ source, flags }`. Redaction runs on
 * every event, in a request or not.
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
    redact: {
      paths: ["**.key", "**.secret", "**.password"],
      patterns: PATTERNS,
    },
    // Every event is kept today. These keep failures, slow requests, and audits (evlog keeps those itself) when a
    // lower rate is set later.
    sampling: { rates: { info: 100, warn: 100, debug: 100, error: 100 }, keep: [{ status: 400 }, { duration: 1000 }] },
  }
}
