import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"

import type { DeploymentPreset } from "vite-hub"

import packageJson from "./package.json" with { type: "json" }

const deploymentName = process.env.VITEHUB_DEPLOYMENT_NAME || packageJson.name
const preset = resolvePreset(process.env.VITEHUB_PRESET)
const isolatedOptimization = preset === "cloudflare" || preset === "vercel"
const rateLimited = preset === "cloudflare" || preset === "node"

export default defineConfig({
  define: {
    __DROP_ISOLATED_OPTIMIZATION__: JSON.stringify(isolatedOptimization),
    __DROP_RATE_LIMITED__: JSON.stringify(rateLimited),
  },
  nitro: {
    cloudflare: preset === "cloudflare" ? {
      wrangler: {
        name: deploymentName,
        observability: { enabled: true },
      },
    } : undefined,
    compatibilityDate: "2026-07-17",
    publicAssets: [
      {
        baseURL: "/.well-known/skills",
        dir: "skills",
        maxAge: 60 * 60 * 24,
      },
    ],
    serverDir: true,
  },
  plugins: [
    vitehub({
      agent: false,
      blob: {
        bucketName: `${deploymentName}-images`,
        ...(preset === "deno" ? { driver: "fs" as const } : {}),
        serve: {
          headers: {
            "Cache-Control": "public, no-cache",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
          },
          route: "/i",
        },
      },
      database: false,
      devtools: false,
      env: false,
      preset,
      queue: isolatedOptimization,
      rateLimit: rateLimited,
      sandbox: isolatedOptimization,
      workflow: false,
      workspace: false,
    }),
    nitro(),
  ],
})

function resolvePreset(value = "cloudflare"): DeploymentPreset {
  switch (value) {
    case "cloudflare":
    case "deno":
    case "netlify":
    case "node":
    case "vercel":
      return value
    default:
      throw new TypeError(`Unsupported VITEHUB_PRESET target: ${value}`)
  }
}
