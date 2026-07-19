import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"

import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
  nitro: {
    cloudflare: {
      wrangler: {
        observability: { enabled: true },
        route: { custom_domain: true, pattern: "drop.vitehub.dev" },
      },
    },
    compatibilityDate: "2026-07-17",
    preset: "cloudflare-module",
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
        bucketName: `${packageJson.name}-images`,
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
      queue: { provider: "cloudflare" },
      rateLimit: {
        namespace: packageJson.name,
      },
      sandbox: { provider: "cloudflare" },
      workflow: false,
      workspace: false,
    }),
    nitro(),
  ],
})
