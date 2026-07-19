import { fileURLToPath } from "node:url"

import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"
import { env } from "vite-hub/env"

import packageJson from "./package.json" with { type: "json" }

const domain = "drop.vitehub.dev"
const imageBucketName = `${packageJson.name}-images`

export default defineConfig(({ command }) => ({
  plugins: [
    vitehub({
      agent: false,
      blob: {
        binding: "DROP_IMAGES",
        bucketName: imageBucketName,
        driver: "cloudflare-r2",
        serve: {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
          },
          publicBaseUrl: `https://${domain}/i`,
          route: "/i",
        },
      },
      database: false,
      devtools: false,
      kv: command === "serve"
        ? { base: ".data/kv", driver: "fs-lite" }
        : { binding: "DROP_STATS", driver: "cloudflare-kv-binding" },
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
    nitro({
      cloudflare: {
        deployConfig: true,
        wrangler: {
          name: packageJson.name,
          kv_namespaces: [{ binding: "DROP_STATS", id: "af46608653384ae685850fd7582475be" }],
          observability: { enabled: true },
          route: { custom_domain: true, pattern: domain },
          vars: {
            DROP_ORIGIN: `https://${domain}`,
            IMAGE_MAX_DIMENSION: "2048",
          },
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
    }),
  ],
  env: {
    server: {
      dropOrigin: env({ default: `https://${domain}`, source: env.source("DROP_ORIGIN") }),
      imageMaxDimension: env({ default: "2048", source: env.source("IMAGE_MAX_DIMENSION") }),
    },
  },
}))
