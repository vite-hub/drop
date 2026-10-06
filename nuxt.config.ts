import { env } from "vite-hub/env"

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "vite-hub/nuxt"],

  vitehub: {
    preset: "cloudflare",
    auth: true,
    blob: { serve: { route: "/f" } },
    browser: { engine: "chromium" },
    database: {
      driver: "d1",
      databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || "vitehub-drop",
      // Local dev and `nuxt prepare` run against a local D1; deploys read the real id from the environment.
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || "00000000-0000-4000-8000-000000000000",
    },
    kv: true,
    queue: true,
    rateLimit: true,
    sandbox: true,
    schedule: true,
  },

  // `nuxt dev` has no R2 binding; keep files on disk (.vitehub/data/blob) while developing.
  $development: {
    vitehub: { blob: { driver: "fs", serve: { route: "/f" } } },
  },

  css: ["@fontsource-variable/geist", "@fontsource-variable/geist-mono", "~/assets/css/main.css"],
  devtools: false,
  compatibilityDate: "2026-07-17",

  app: {
    head: {
      htmlAttrs: { lang: "en" },
      link: [
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
    },
  },

  ui: {
    colorMode: true,
    // Geist is self-hosted from Fontsource (see `css`).
    fonts: false,
  },

  icon: {
    provider: "none",
    // Kind icons are picked at runtime (KIND_ICONS), so the scanner can't see them.
    clientBundle: { scan: true, icons: ["lucide:file-text", "lucide:code", "lucide:image", "lucide:file", "lucide:folder", "lucide:bot", "lucide:key-round", "lucide:user"] },
  },

  nitro: {
    cloudflare: { wrangler: { observability: { enabled: true } } },
    // Listing publicAssets replaces Nuxt's default, so `public/` is listed too.
    publicAssets: [
      { baseURL: "/", dir: "public", maxAge: 60 * 60 },
      { baseURL: "/vendor/medium-zoom", dir: "node_modules/medium-zoom/dist", maxAge: 60 * 60 * 24 * 365 },
      { baseURL: "/.well-known/skills", dir: "skills", maxAge: 60 * 60 * 24 },
    ],
  },

  hooks: {
    // The CLI nightly adds a dev-only socket-cleanup plugin from @nuxt/cli, which this Nuxt nightly's
    // server import protection rejects. Dev works without it.
    "nitro:config"(config) {
      config.plugins = config.plugins?.filter(plugin => !String(plugin).includes("dev-close-sockets"))
    },
  },

  vite: {
    env: {
      server: {
        auth: {
          github: {
            // Declared secret so wrangler passes it through with the others (it only injects declared secrets).
            clientId: env({ secret: true, source: env.source("GITHUB_CLIENT_ID") }),
            clientSecret: env({ secret: true, source: env.source("GITHUB_CLIENT_SECRET") }),
          },
          secret: env({ secret: true, source: env.source("BETTER_AUTH_SECRET") }),
        },
      },
    },
  } as never,
})
