import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"

import packageJson from "./package.json" with { type: "json" }

const deploymentName = process.env.DROP_DEPLOYMENT_NAME || packageJson.name
const hosting = process.env.VITEHUB_HOSTING || "cloudflare"
const queueNamespace = deploymentName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(-16)
const profile = resolveHostingProfile(hosting)

export default defineConfig({
  define: {
    __DROP_ASYNC_OPTIMIZATION__: JSON.stringify(profile.asyncOptimization),
  },
  nitro: {
    cloudflare: profile.provider === "cloudflare" ? {
      wrangler: {
        name: deploymentName,
        observability: { enabled: true },
      },
    } : undefined,
    compatibilityDate: "2026-07-17",
    preset: profile.preset,
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
        ...(profile.provider === "vercel" ? { access: "private" as const, driver: "vercel-blob" as const } : {}),
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
      queue: profile.queue,
      rateLimit: {
        namespace: deploymentName,
        provider: profile.provider === "cloudflare" ? "cloudflare" : "memory",
      },
      sandbox: profile.sandbox,
      workflow: false,
      workspace: false,
    }),
    nitro(),
  ],
})

function resolveHostingProfile(hosting: string) {
  switch (hosting) {
    case "cloudflare":
    case "cloudflare-module":
      return {
        asyncOptimization: true,
        preset: "cloudflare-module",
        provider: "cloudflare" as const,
        queue: {
          namePrefix: `${queueNamespace}-`,
          provider: "cloudflare" as const,
        },
        sandbox: {
          name: `${deploymentName}-sandbox`,
          provider: "cloudflare" as const,
        },
      }
    case "vercel":
      return {
        asyncOptimization: false,
        preset: "vercel",
        provider: "vercel" as const,
        queue: false,
        sandbox: false,
      }
    case "netlify":
      return {
        asyncOptimization: false,
        preset: "netlify",
        provider: "netlify" as const,
        queue: false,
        sandbox: false,
      }
    case "deno-deploy":
      return {
        asyncOptimization: false,
        preset: "deno-deploy",
        provider: "deno-deploy" as const,
        queue: false,
        sandbox: false,
      }
    case "node-server":
      return {
        asyncOptimization: false,
        preset: "node-server",
        provider: "node-server" as const,
        queue: false,
        sandbox: false,
      }
    default:
      throw new TypeError(`Unsupported VITEHUB_HOSTING target: ${hosting}`)
  }
}
