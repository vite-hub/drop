import evlog from "evlog/nitro/v3"
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
      modules: [
        evlog({
          env: {
            service: "vitehub-drop",
          },
          include: ["/api/**"],
          redact: true,
        }),
      ],
      imports: {
        dts: ".vitehub/nitro-imports.d.ts",
        presets: [
          {
            from: "h3",
            imports: ["assertBodySize", "defineHandler", "readValidatedBody", "requireContentType"],
          },
          {
            from: "vite-hub/blob",
            imports: ["blob"],
          },
          {
            from: "vite-hub/browser",
            imports: [
              { name: "BrowserDownload", type: true },
              { name: "BrowserPageSession", type: true },
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
          baseURL: "/.well-known/skills",
          dir: "skills",
          maxAge: 60 * 60 * 24,
        },
      ],
      serverDir: true,
    }),
  ],
})
