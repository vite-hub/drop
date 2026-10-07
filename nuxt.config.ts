import { fileURLToPath } from "node:url"
import evlog from "evlog/nitro/v3"
import { env } from "vite-hub/env"

const skillsHandler = fileURLToPath(new URL("./server/handlers/skills.ts", import.meta.url))
const oauthMetadataHandler = fileURLToPath(new URL("./server/handlers/oauth-metadata.ts", import.meta.url))

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@vueuse/nuxt", "vite-hub/nuxt"],

  vitehub: {
    preset: "cloudflare",
    auth: true,
    blob: { serve: { route: "/f" } },
    // Stateless Browser Run actions only (code-image screenshots): no Playwright, no page sessions.
    browser: true,
    database: {
      driver: "d1",
      databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || "vitehub-drop",
      // Local dev and `nuxt prepare` run against a local D1; deploys read the real id from the environment.
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || "00000000-0000-4000-8000-000000000000",
    },
    kv: true,
    rateLimit: true,
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
    // Kind and agent icons are picked at runtime (KIND_ICONS, agentLogo), so the scanner can't see them.
    clientBundle: {
      scan: true,
      icons: [
        "lucide:file-text", "lucide:code", "lucide:image", "lucide:file", "lucide:folder", "lucide:bot", "lucide:key-round", "lucide:user",
        "simple-icons:claude", "simple-icons:openai", "simple-icons:cursor", "simple-icons:githubcopilot", "simple-icons:googlegemini",
        "simple-icons:windsurf", "simple-icons:zedindustries", "simple-icons:opencode", "simple-icons:githubactions",
      ],
    },
  },

  nitro: {
    // Cached handlers (defineCachedHandler) share the Worker's KV; `base` keeps their keys apart from ViteHub's.
    storage: { cache: { driver: "cloudflare-kv-binding", binding: "KV", base: "nitro-cache" } },
    devStorage: { cache: { driver: "memory" } },
    // One structured "wide event" per request (evlog), with who called, what they did, and why it failed.
    // On Workers it prints JSON to the console, which Workers Logs indexes and lets you query.
    modules: [evlog({
      env: { service: "drop" },
      exclude: ["/_nuxt/**", "/_fonts/**", "/vendor/**", "/favicon.svg", "/__nuxt_error"],
      redact: { paths: ["**.key", "**.secret", "**.password"] },
    })],
    cloudflare: {
      wrangler: {
        observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: true } },
        // Preserve the pre-Nuxt Sandbox migration before deleting its old Durable Object class.
        migrations: [
          { tag: "v1", new_sqlite_classes: ["Sandbox"] },
          { tag: "v2", deleted_classes: ["Sandbox"] },
        ],
      },
    },
    // Listing publicAssets replaces Nuxt's default, so `public/` is listed too.
    publicAssets: [
      { baseURL: "/", dir: "public", maxAge: 60 * 60 },
      { baseURL: "/vendor/medium-zoom", dir: "node_modules/medium-zoom/dist", maxAge: 60 * 60 * 24 * 365 },
    ],
  },

  // Agent Skills Discovery, v0.2.0 and the older v0.1.0 path (server/utils/skills.ts holds the skills).
  serverHandlers: [
    { route: "/.well-known/agent-skills/**", handler: skillsHandler, lazy: true },
    { route: "/.well-known/skills/**", handler: skillsHandler, lazy: true },
    ...["oauth-protected-resource", "oauth-authorization-server", "openid-configuration"].flatMap(name => [
      { route: `/.well-known/${name}`, handler: oauthMetadataHandler, lazy: true },
      { route: `/.well-known/${name}/**`, handler: oauthMetadataHandler, lazy: true },
    ]),
  ],

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
        drop: {
          // GitHub user ids (not logins, which can be renamed and reclaimed) that sign in as admins, comma-separated.
          admins: env({ secret: true, source: env.source("DROP_ADMINS") }),
        },
      },
    },
  } as never,
})
