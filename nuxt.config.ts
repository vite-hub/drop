import { fileURLToPath } from "node:url"
import evlog from "evlog/nitro/v3"
import type { NuxtConfig } from "nuxt/schema"
import { env } from "vite-hub/env"
import { DEFAULT_EXPIRY_DAYS } from "./shared/expiry.ts"
import { DEFAULT_PRO_LIMITS, PLANS } from "./shared/quotas.ts"
import { cloudflareTemplate, syncCloudflareTemplate } from "./scripts/cloudflare-template.ts"
import { deployment, type Host } from "./scripts/deployment.ts"

const skillsHandler = fileURLToPath(new URL("./server/handlers/skills.ts", import.meta.url))
const oauthMetadataHandler = fileURLToPath(new URL("./server/handlers/oauth-metadata.ts", import.meta.url))

const { host, database } = deployment()
const liveEditing = host === "cloudflare" || host === "vps"

// The blob handler also handles conditional requests; keep its policy aligned with the access gate.
const files = { serve: { route: "/f", headers: { "Cache-Control": "private, no-store" } } }

// D1's HTTP driver works from every host. The account and API token are read at runtime.
const d1 = (fallback: string) => ({
  driver: "d1" as const,
  databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || fallback,
  // ViteHub needs the id while it generates the runtime database registry.
  databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || "00000000-0000-4000-8000-000000000000",
  cloudflare: { http: true },
})

/**
 * ViteHub per host. Only Cloudflare has Browser Run (PNG code images), a distributed rate limiter, and KV
 * for Nitro's cache. Elsewhere code images are SVG only, rate limits count per server instance (ViteHub's
 * in-memory limiter), and Nitro's cache stays in memory.
 */
const VITEHUB: Record<Host, NonNullable<NuxtConfig["vitehub"]>> = {
  cloudflare: {
    preset: "cloudflare",
    blob: files,
    // Stateless Browser Run actions only (code-image screenshots): no Playwright, no page sessions.
    browser: true,
    database: {
      driver: "d1",
      databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || cloudflareTemplate.d1_databases[0]!.database_name,
      // Local dev and `nuxt prepare` run against a local D1; deploys read the real id from the environment.
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || cloudflareTemplate.d1_databases[0]!.database_id,
    },
    kv: true,
    rateLimit: true,
    schedule: true,
    // Live editing: rooms in a SQLite Durable Object, drafts in BLOB (server/live-drafts/realtime.ts).
    realtime: { authority: "cloudflare" },
  },
  // Vercel Blob (a private store, BLOB_READ_WRITE_TOKEN), D1 over HTTP, and cleanup as a Vercel Cron Job. The deploy build sets it to daily for Hobby.
  vercel: { preset: "vercel", blob: { ...files, driver: "vercel-blob", access: "private" }, database: d1("vitehub-drop-vercel"), schedule: true },
  // Netlify Blobs, D1 over HTTP, and the cleanup as a scheduled function (.netlify/v1/functions).
  netlify: { preset: "netlify", blob: files, database: d1("vitehub-drop-netlify"), schedule: { providerOutput: "standalone" } },
  // Deno Deploy has no blob store of its own, so files go to an S3-compatible bucket (R2, S3, Tigris). ViteHub's
  // Deno preset has no schedule, so none of the hourly cleanup runs: expired drops and code images stop being served
  // but stay stored, the Trash is never purged, and unused OAuth clients stay registered.
  deno: {
    preset: "deno",
    blob: { ...files, driver: "s3", bucket: process.env.S3_BUCKET || "drop", endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "auto" },
    database: d1("vitehub-drop-deno"),
  },
  // One Node process: local SQLite or explicit D1, files on disk under .data/, in-memory rate limits, and cleanup on a
  // timer inside the process (its run history in KV files).
  vps: {
    preset: "node",
    blob: { ...files, driver: "fs", base: ".data/blob" },
    database: database === "sqlite" ? { connection: { url: env({ source: env.source("DROP_DATABASE_URL"), default: "file:.data/database/drop.db" }) } } : d1("vitehub-drop-vps"),
    kv: { driver: "fs-lite", base: ".data/kv" },
    rateLimit: true,
    schedule: { runtime: { driver: "process" } },
    // Live editing rooms stay in this one process and save their drafts to .data/blob.
    realtime: { authority: "memory" },
  },
}

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@vueuse/nuxt", "vite-hub/nuxt"],

  vitehub: { ...VITEHUB[host], auth: true },

  alias: {
    // PNG code images are a Browser Run screenshot. Browser Run only exists on Cloudflare, and ViteHub only
    // generates its runtime module in builds that enable it, so other hosts get a stub that says so.
    "#code-image-png": fileURLToPath(new URL(`./server/code-image-png/${host === "cloudflare" ? "browser-run" : "unavailable"}.ts`, import.meta.url)),
    // Live editing needs Realtime rooms, which only Cloudflare and VPS builds have. The others get a stub that says so.
    "#live-drafts": fileURLToPath(new URL(`./server/live-drafts/${liveEditing ? "realtime" : "unavailable"}.ts`, import.meta.url)),
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
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
        { rel: "icon", href: "/icon.png", type: "image/png", sizes: "512x512" },
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
        "ph:file-text", "ph:code", "ph:image", "ph:file", "ph:folder", "ph:robot", "ph:key", "ph:user",
        "simple-icons:claude", "simple-icons:openai", "simple-icons:cursor", "simple-icons:githubcopilot", "simple-icons:googlegemini",
        "simple-icons:windsurf", "simple-icons:zedindustries", "simple-icons:opencode", "simple-icons:githubactions",
        // Host icons in the docs (app/utils/docs.ts).
        "simple-icons:cloudflare", "simple-icons:vercel", "simple-icons:netlify", "simple-icons:deno", "ph:hard-drives",
      ],
    },
  },

  nitro: {
    // Drizzle applies the existing migration journal before a local Node instance serves requests.
    plugins: database === "sqlite" ? [fileURLToPath(new URL("./server/database-migrate.ts", import.meta.url))] : [],
    errorHandler: fileURLToPath(new URL("./server/handlers/content-error.ts", import.meta.url)),
    // Cached handlers (defineCachedHandler) share the Worker's KV; `base` keeps their keys apart from ViteHub's.
    // Other hosts keep Nitro's default in-memory cache.
    ...(host === "cloudflare" ? { storage: { cache: { driver: "cloudflare-kv-binding", binding: "KV", base: "nitro-cache" } } } : {}),
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
        name: cloudflareTemplate.name,
        observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: true } },
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
    "nitro:init"(nitro) {
      if (host === "cloudflare") nitro.hooks.hook("compiled", () => syncCloudflareTemplate(nitro.options.output.serverDir))
    },
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
            clientId: env({ secret: true, source: env.source("GITHUB_CLIENT_ID"), default: "" }),
            clientSecret: env({ secret: true, source: env.source("GITHUB_CLIENT_SECRET"), default: "" }),
          },
          secret: env({ secret: true, source: env.source("BETTER_AUTH_SECRET") }),
        },
        // Every Drop setting is read at runtime: changing one needs a restart, not a rebuild. Each also reads its
        // canonical VITEHUB_DROP_* name first (VITEHUB_DROP_QUOTAS_ENABLED for quotas.enabled).
        drop: {
          // GitHub user ids (not logins, which can be renamed and reclaimed) that sign in as admins, comma-separated.
          admins: env({ secret: true, source: env.source("DROP_ADMINS") }),
          // Only active members of this GitHub organization may sign in, open shared links, or use MCP.
          githubOrg: env({ source: env.source("DROP_GITHUB_ORG"), default: "" }),
          // Sign in through an existing GitHub oauth2-proxy instead of Drop's own GitHub app (server/utils/proxy-auth.ts).
          authProxy: env.boolean({ source: env.source("DROP_AUTH_PROXY"), default: false }),
          authProxyCookie: env({ source: env.source("DROP_AUTH_PROXY_COOKIE"), default: "" }),
          // Email and password sign-in outside `nuxt dev`, for the runtime tests.
          testSignin: env.boolean({ source: env.source("DROP_TEST_SIGNIN"), default: false }),
          shareApproval: env.boolean({ source: env.source("DROP_SHARE_APPROVAL"), default: false }),
          abuseEmail: env({ source: env.source("DROP_ABUSE_EMAIL"), default: "" }),
          // Days a review drop lives after its last visit (temporary ones at most 14); 0 keeps every drop.
          expiryDays: env.number({ source: env.source("DROP_EXPIRY_DAYS"), default: DEFAULT_EXPIRY_DAYS }),
          // false lets only admins keep drops.
          customExpiry: env.boolean({ source: env.source("DROP_CUSTOM_EXPIRY"), default: true }),
          // Where apps and HTML docs run: https://*-drop.example.com gives each drop its own subdomain (see server/utils/content-origin.ts).
          contentOrigin: env({ source: env.source("DROP_CONTENT_ORIGIN"), default: "" }),
          // Owner quotas: one plan for everyone (shared/quotas.ts).
          quotas: {
            enabled: env.boolean({ source: env.source("DROP_QUOTAS"), default: false }),
            plan: env.enum(PLANS, { source: env.source("DROP_DEFAULT_PLAN"), default: "free" }),
            proDrops: env.number({ source: env.source("DROP_PRO_DROPS"), default: DEFAULT_PRO_LIMITS.drops }),
            proBytes: env.number({ source: env.source("DROP_PRO_BYTES"), default: DEFAULT_PRO_LIMITS.bytes }),
            proWrites: env.number({ source: env.source("DROP_PRO_WRITES"), default: DEFAULT_PRO_LIMITS.writes }),
          },
        },
      },
    },
  } as never,
})
