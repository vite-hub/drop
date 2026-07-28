import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"

export default defineConfig({
  plugins: [
    vitehub({
      blob: {
        serve: {
          route: "/i",
        },
      },
      browser: true,
      kv: true,
      preset: "cloudflare",
      queue: true,
      rateLimit: true,
      sandbox: true,
      schedule: true,
    }),
    nitro({
      cloudflare: {
        wrangler: {
          observability: { enabled: true },
        },
      },
      compatibilityDate: "2026-07-17",
      publicAssets: [
        {
          baseURL: "/.well-known/skills",
          dir: "skills",
          maxAge: 60 * 60 * 24,
        },
      ],
      serverDir: true,
    }),
  ],
})
