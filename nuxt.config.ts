import { fileURLToPath } from "node:url"
import evlog from "evlog/nitro/v3"
import type { NuxtConfig } from "nuxt/schema"
import { env } from "vite-hub/env"

const skillsHandler = fileURLToPath(new URL("./server/handlers/skills.ts", import.meta.url))
const oauthMetadataHandler = fileURLToPath(new URL("./server/handlers/oauth-metadata.ts", import.meta.url))

/**
 * Where this build runs, picked at build time: `DROP_HOST=vercel pnpm build`. Cloudflare is the default.
 * Every host keeps a SQLite-family database, so the migrations in server/databases/migrations apply as they are.
 */
const HOSTS = ["cloudflare", "vercel", "netlify", "deno", "vps"] as const
type Host = typeof HOSTS[number]
const host = (process.env.DROP_HOST || "cloudflare") as Host
if (!HOSTS.includes(host)) throw new Error(`DROP_HOST must be one of ${HOSTS.join(", ")}; got "${host}".`)

// Hosted libSQL (Turso) on the serverless hosts, read at runtime. The VPS defaults to a SQLite file in .data/.
const libsql = (fallback?: string) => ({
  url: env({ source: env.source(["TURSO_DATABASE_URL", "DATABASE_URL"]), ...(fallback ? { default: fallback } : {}) }),
  authToken: env({ secret: true, optional: true, source: env.source(["TURSO_AUTH_TOKEN", "DATABASE_AUTH_TOKEN"]) }),
})
const files = { serve: { route: "/f" } }

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
      databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || "vitehub-drop",
      // Local dev and `nuxt prepare` run against a local D1; deploys read the real id from the environment.
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || "00000000-0000-4000-8000-000000000000",
    },
    kv: true,
    rateLimit: true,
    schedule: true,
  },
  // Vercel Blob (a private store, BLOB_READ_WRITE_TOKEN), Turso, and the hourly cleanup as a Vercel Cron Job.
  vercel: { preset: "vercel", blob: { ...files, driver: "vercel-blob", access: "private" }, database: { connection: libsql() }, schedule: true },
  // Netlify Blobs, Turso, and the cleanup as a scheduled function (.netlify/v1/functions).
  netlify: { preset: "netlify", blob: files, database: { connection: libsql() }, schedule: { providerOutput: "standalone" } },
  // Deno Deploy has no blob store of its own, so files go to an S3-compatible bucket (R2, S3, Tigris). ViteHub's
  // Deno preset has no schedule: expired code images stop being served but stay in the bucket.
  deno: {
    preset: "deno",
    blob: { ...files, driver: "s3", bucket: process.env.S3_BUCKET || "drop", endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "auto" },
    database: { connection: libsql() },
  },
  // One Node process: a SQLite file and files on disk under .data/, in-memory rate limits, and the cleanup on a
  // timer inside the process (its run history in KV files).
  vps: {
    preset: "node",
    blob: { ...files, driver: "fs", base: ".data/blob" },
    database: { connection: libsql("file:.data/drop.sqlite") },
    kv: { driver: "fs-lite", base: ".data/kv" },
    rateLimit: true,
    schedule: { runtime: { driver: "process" } },
  },
}

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@vueuse/nuxt", "vite-hub/nuxt"],

  vitehub: { ...VITEHUB[host], auth: true },

  alias: {
    // PNG code images are a Browser Run screenshot. Browser Run only exists on Cloudflare, and ViteHub only
    // generates its runtime module in builds that enable it, so other hosts get a stub that says so.
    "#code-image-png": fileURLToPath(new URL(`./server/code-image-png/${host === "cloudflare" ? "browser-run" : "unavailable"}.ts`, import.meta.url)),
  },

  // `nuxt dev` has no R2 binding; keep files on disk (.vitehub/data/blob) while developing.
  $development: {
    vitehub: { blob: { driver: "fs", serve: { route: "/f" } } },
  },

  // The public docs are the same for everyone: built once, served as static HTML on every host.
  routeRules: { "/docs": { prerender: true }, "/docs/**": { prerender: true } },

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
        // Host icons in the docs (app/utils/docs.ts).
        "simple-icons:cloudflare", "simple-icons:vercel", "simple-icons:netlify", "simple-icons:deno", "lucide:server",
      ],
    },
  },

  nitro: {
    // Cached handlers (defineCachedHandler) share the Worker's KV; `base` keeps their keys apart from ViteHub's.
    // Other hosts keep Nitro's default in-memory cache.
    ...(host === "cloudflare" ? { storage: { cache: { driver: "cloudflare-kv-binding", binding: "KV", base: "nitro-cache" } } } : {}),
    // Netlify Functions can't load libSQL's native binary; the `netlify` condition picks @libsql/client's HTTP-only build.
    ...(host === "netlify" ? { exportConditions: ["netlify"] } : {}),
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
