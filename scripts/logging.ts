import type evlog from "evlog/nitro/v3"

type EvlogOptions = NonNullable<Parameters<typeof evlog>[0]>

const serializable = (pattern: RegExp) =>
  Object.assign(pattern, { toJSON: () => ({ source: pattern.source, flags: pattern.flags }) })

const PATTERNS = [
  serializable(/(?<=\/api\/(?:uploads|auth\/reset-password)\/)[^/?#\s"]+/g),
  serializable(
    new RegExp(
      String.raw`(?<![\w:.])(?:(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|:(?::[\da-f]{1,4}){1,7})(?![\w:])`,
      "gi",
    ),
  ),
]

export function evlogOptions(release: { version: string; commit: string }): EvlogOptions {
  return {
    env: { service: "drop", version: release.version, ...(release.commit ? { commitHash: release.commit } : {}) },
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
    sampling: { rates: { info: 100, warn: 100, debug: 100, error: 100 }, keep: [{ status: 400 }, { duration: 1000 }] },
  }
}
