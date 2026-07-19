import { fileURLToPath } from "node:url"

import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"

import packageJson from "./package.json" with { type: "json" }

const domain = "drop.vitehub.dev"
const imageBucketName = `${packageJson.name}-images`

export default defineConfig(({ command }) => ({
  nitro: {
    cloudflare: {
      deployConfig: true,
      wrangler: {
        name: packageJson.name,
        observability: { enabled: true },
        route: { custom_domain: true, pattern: domain },
      },
    },
    compatibilityDate: "2026-07-17",
    preset: "cloudflare-module",
    publicAssets: [
      {
        baseURL: "/.well-known/skills",
        dir: fileURLToPath(new URL("./skills", import.meta.url)),
        maxAge: 60 * 60 * 24,
      },
    ],
    renderer: false,
    serverDir: true,
  },
  plugins: [
    vitehub({
      agent: false,
      blob: {
        binding: "DROP_IMAGES",
        bucketName: imageBucketName,
        driver: "cloudflare-r2",
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
      kv: false,
      queue: { provider: "cloudflare" },
      rateLimit: {
        namespace: packageJson.name,
        provider: command === "serve" ? "memory" : "cloudflare",
      },
      sandbox: {
        provider: "cloudflare",
        sandboxId: "drop-image-optimizer",
        sleepAfter: "5m",
      },
      workflow: false,
      workspace: false,
    }),
    nitro(),
  ],
}))
