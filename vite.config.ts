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
      browser: { engine: "chromium" },
      kv: true,
      preset: "cloudflare",
      queue: true,
      rateLimit: true,
      sandbox: true,
      schedule: true,
    }),
    nitro({
      imports: {
        dts: ".vitehub/nitro-imports.d.ts",
        presets: [
          {
            from: "h3",
            imports: ["assertBodySize", "defineHandler", "HTTPError", "readValidatedBody", "requireContentType"],
          },
          {
            from: "vite-hub/blob",
            imports: ["blob"],
          },
          {
            from: "vite-hub/browser",
            imports: [
              "defineBrowser",
              "runBrowser",
            ],
          },
          {
            from: "vite-hub/rate-limit",
            imports: ["requireRateLimit"],
          },
          {
            from: "vite-hub/schedule",
            imports: ["defineSchedule"],
          },
        ],
      },
      cloudflare: {
        wrangler: {
          observability: { enabled: true },
        },
      },
      compatibilityDate: "2026-07-17",
      publicAssets: [
        {
          baseURL: "/vendor/medium-zoom",
          dir: "node_modules/medium-zoom/dist",
          maxAge: 60 * 60 * 24 * 365,
        },
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
