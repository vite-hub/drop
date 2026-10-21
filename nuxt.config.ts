import { fileURLToPath } from "node:url"
import evlog from "evlog/nitro/v3"
import type { NuxtConfig } from "nuxt/schema"
import { env } from "vite-hub/env"
import { DROP_PAGE_ROUTES } from "./shared/csp.ts"
import { DEFAULT_EXPIRY_DAYS } from "./shared/expiry.ts"
import { DEFAULT_PRO_LIMITS, PLANS } from "./shared/quotas.ts"
import { cloudflareTemplate, syncCloudflareTemplate } from "./scripts/cloudflare-template.ts"
import { deployment, type Host } from "./scripts/deployment.ts"

const skillsHandler = fileURLToPath(new URL("./server/handlers/skills.ts", import.meta.url))
const oauthMetadataHandler = fileURLToPath(new URL("./server/handlers/oauth-metadata.ts", import.meta.url))

const { host, database } = deployment()
const liveEditing = host === "cloudflare" || host === "vps"

// The browser keeps a file but asks again on every use: the access gate runs each time, and an unchanged file answers
// 304 without its bytes (the blob handler handles conditional requests). server/plugins/content-headers.ts agrees.
const files = { serve: { route: "/f", headers: { "Cache-Control": "private, no-cache" } } }

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
  vercel: {
    preset: "vercel",
    blob: { ...files, driver: "vercel-blob", access: "private" },
    database: d1("vitehub-drop-vercel"),
    schedule: true,
  },
  // Netlify Blobs, D1 over HTTP, and the cleanup as a scheduled function (.netlify/v1/functions).
  netlify: {
    preset: "netlify",
    blob: files,
    database: d1("vitehub-drop-netlify"),
    schedule: { providerOutput: "standalone" },
  },
  // Deno Deploy has no blob store of its own, so files go to an S3-compatible bucket (R2, S3, Tigris). ViteHub's
  // Deno preset has no schedule, so none of the hourly cleanup runs: expired drops and code images stop being served
  // but stay stored, the Trash is never purged, and unused OAuth clients stay registered.
  deno: {
    preset: "deno",
    blob: {
      ...files,
      driver: "s3",
      bucket: process.env.S3_BUCKET || "drop",
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "auto",
    },
    database: d1("vitehub-drop-deno"),
  },
  // One Node process: local SQLite or explicit D1, files on disk under .data/, in-memory rate limits, and cleanup on a
  // timer inside the process (its run history in KV files).
  vps: {
    preset: "node",
    blob: { ...files, driver: "fs", base: ".data/blob" },
    database:
      database === "sqlite"
        ? {
            connection: {
              url: env({ source: env.source("DROP_DATABASE_URL"), default: "file:.data/database/drop.db" }),
            },
          }
        : d1("vitehub-drop-vps"),
    kv: { driver: "fs-lite", base: ".data/kv" },
    rateLimit: true,
    schedule: { runtime: { driver: "process" } },
    // Live editing rooms stay in this one process and save their drafts to .data/blob.
    realtime: { authority: "memory" },
  },
}

type RouteRule = NonNullable<NuxtConfig["routeRules"]>[string]

// Drops' pages show drops in srcdoc frames, which inherit the page's CSP: no script policy there, only frame-ancestors
// (shared/csp.ts; app/plugins/csp-boundary.client.ts loads them fresh from a page that has one).
const DROP_PAGE: RouteRule = {
  security: {
    headers: {
      contentSecurityPolicy: {
        "base-uri": false,
        "object-src": false,
        "form-action": false,
        "script-src": false,
        "script-src-attr": false,
        "style-src": false,
        "img-src": false,
        "font-src": false,
        "frame-ancestors": ["'none'"],
      },
    },
  },
}
const SIGNED_IN: RouteRule = { appMiddleware: { auth: true }, appLayout: "dashboard" }

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@vueuse/nuxt", "vite-hub/nuxt", "vite-doctor/nuxt", "nuxt-security"],

  vitehub: { ...VITEHUB[host], auth: true },

  alias: {
    // PNG code images are a Browser Run screenshot. Browser Run only exists on Cloudflare, and ViteHub only
    // generates its runtime module in builds that enable it, so other hosts get a stub that says so.
    "#code-image-png": fileURLToPath(
      new URL(`./server/code-image-png/${host === "cloudflare" ? "browser-run" : "unavailable"}.ts`, import.meta.url),
    ),
    // Live editing needs Realtime rooms, which only Cloudflare and VPS builds have. The others get a stub that says so.
    "#live-drafts": fileURLToPath(
      new URL(`./server/live-drafts/${liveEditing ? "realtime" : "unavailable"}.ts`, import.meta.url),
    ),
  },

  // `nuxt dev` has no R2 binding; keep files on disk (.vitehub/data/blob) while developing.
  $development: {
    vitehub: { blob: { driver: "fs", serve: { route: "/f" } } },
  },

  css: [
    "@fontsource-variable/geist",
    "@fontsource-variable/geist-mono",
    "@fontsource/instrument-serif/latin-400-italic.css",
    "~/assets/css/main.css",
  ],
  devtools: false,
  compatibilityDate: "2026-07-17",

  // Off: every page answers noindex (server/plugins/content-headers.ts).
  // tldraw needs a license key in production (NUXT_PUBLIC_TLDRAW_LICENSE_KEY); without one, boards show its watermark.
  // doctor-disable-next-line nuxt/runtime/no-secret-in-public-config -- tldraw license keys are public: the browser runs tldraw and checks the key against the domain.
  runtimeConfig: { seoIndex: false, public: { tldrawLicenseKey: "" } },

  // nuxt-security (patched for Nuxt 5) writes the security headers. Drop keeps its own rate limits, same-origin write
  // check, and body limits, so the module's request middlewares stay off.
  security: {
    rateLimiter: false,
    requestSizeLimiter: false,
    xssValidator: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    // It would strip console from the server bundle too, which is where Drop's logs go.
    removeLoggers: false,
    sri: false,
    headers: {
      // The review popup must keep `window.opener` to the site under review, and Drop frames other origins: its
      // content origin and sites under review.
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      // server/middleware/0.07.frame-options.ts sends DENY on Drop's own origin only: the content origin must stay
      // frameable, and this header would reach it as a route rule.
      xFrameOptions: false,
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: { maxAge: 31536000, includeSubdomains: false },
      // Screen capture stays on for Drop itself: reviewing a site inside Drop screenshots it that way.
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
        usb: [],
        serial: [],
        hid: [],
        "display-capture": ["self"],
        fullscreen: false,
      },
      contentSecurityPolicy: {
        "base-uri": ["'none'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "script-src": ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"],
        "script-src-attr": ["'none'"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "img-src": ["'self'", "https:", "data:", "blob:"],
        "font-src": ["'self'", "https:", "data:"],
        // Sites under review may be http on localhost, and self-hosted Drops may run over http.
        "upgrade-insecure-requests": false,
      },
    },
  },

  routeRules: {
    ...Object.fromEntries(DROP_PAGE_ROUTES.map((route) => [route, DROP_PAGE])),
    // The signed-in pages and the docs by path, instead of each page's definePageMeta. Nuxt merges every rule a path
    // matches, so `/drops` gets SIGNED_IN from `/drops/**` too. The landing (pages/index.vue) and shared links
    // (pages/d/) pick their own layout in their own middleware.
    "/drops/**": { ...DROP_PAGE, ...SIGNED_IN },
    "/agents": SIGNED_IN,
    "/members": SIGNED_IN,
    "/skills/**": SIGNED_IN,
    "/admin/**": SIGNED_IN,
    "/docs/**": { appLayout: "docs" },
    // The policies sit in the docs nav, so they keep its sidebar.
    "/terms": { appLayout: "docs" },
    "/acceptable-use": { appLayout: "docs" },
    "/abuse": { appLayout: "docs" },
  },

  experimental: { typescriptPlugin: true },

  // media-chrome's elements (app/components/viewer/ViewerVideo.vue) are web components, not Vue components.
  vue: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("media-") } },

  typescript: {
    strict: true,
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        noFallthroughCasesInSwitch: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      },
    },
  },

  app: {
    // Not Nuxt's default /_nuxt/: apps built with Nuxt load their chunks from /_nuxt/ on their content origin, which this
    // same deployment serves, and Drop's own asset paths come first there (server/utils/app-files.ts).
    buildAssetsDir: "/_drop-ui/",
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
        "mingcute:document-2-line",
        "mingcute:code-line",
        "mingcute:pic-2-line",
        "mingcute:file-line",
        "mingcute:folder-line",
        "mingcute:layout-line",
        "mingcute:world-2-line",
        "mingcute:drawing-board-line",
        "mingcute:sparkles-line",
        "mingcute:key-2-line",
        "mingcute:user-3-line",
        "simple-icons:claude",
        "simple-icons:openai",
        "simple-icons:cursor",
        "simple-icons:githubcopilot",
        "simple-icons:googlegemini",
        "simple-icons:windsurf",
        "simple-icons:zedindustries",
        "simple-icons:opencode",
        "simple-icons:githubactions",
        // Host icons in the docs (app/utils/docs.ts).
        "simple-icons:cloudflare",
        "simple-icons:vercel",
        "simple-icons:netlify",
        "simple-icons:deno",
        "mingcute:server-2-line",
        // Share states' icons (SHARE_ICONS in shared/share.ts) that no template names.
        "mingcute:group-3-line",
        // The Get started checklist's step marks (app/components/GetStarted.vue).
        "mingcute:check-circle-fill",
        "mingcute:round-line",
        // Nuxt UI's own icons (app.config ui.icons): the scanner reads templates, not app.config, so without these the
        // color-mode toggle, close buttons, carets, and spinners render empty.
        "mingcute:refresh-anticlockwise-1-line",
        "mingcute:arrow-down-line",
        "mingcute:arrow-left-line",
        "mingcute:arrow-right-line",
        "mingcute:arrow-up-line",
        "mingcute:arrow-right-up-line",
        "mingcute:arrows-left-line",
        "mingcute:arrows-right-line",
        "mingcute:down-line",
        "mingcute:left-line",
        "mingcute:right-line",
        "mingcute:up-line",
        "mingcute:check-line",
        "mingcute:check-circle-line",
        "mingcute:loading-line",
        "mingcute:copy-2-line",
        "mingcute:dots-line",
        "mingcute:more-1-line",
        "mingcute:eye-2-line",
        "mingcute:eye-close-line",
        "mingcute:folder-open-line",
        "mingcute:hashtag-line",
        "mingcute:information-line",
        "mingcute:bulb-line",
        "mingcute:menu-line",
        "mingcute:search-line",
        "mingcute:minimize-line",
        "mingcute:computer-line",
        "mingcute:moon-line",
        "mingcute:add-line",
        "mingcute:layout-left-line",
        "mingcute:star-line",
        "mingcute:stop-line",
        "mingcute:sun-line",
        "mingcute:upload-2-line",
        "mingcute:alert-line",
        "mingcute:warning-line",
        "mingcute:close-line",
        "mingcute:close-circle-line",
      ],
    },
  },

  nitro: {
    // Drizzle applies the existing migration journal before a local Node instance serves requests.
    plugins: database === "sqlite" ? [fileURLToPath(new URL("./server/database-migrate.ts", import.meta.url))] : [],
    errorHandler: fileURLToPath(new URL("./server/handlers/content-error.ts", import.meta.url)),
    // Cached handlers (defineCachedHandler) share the Worker's KV; `base` keeps their keys apart from ViteHub's.
    // Other hosts keep Nitro's default in-memory cache.
    ...(host === "cloudflare"
      ? { storage: { cache: { driver: "cloudflare-kv-binding", binding: "KV", base: "nitro-cache" } } }
      : {}),
    devStorage: { cache: { driver: "memory" } },
    // One structured "wide event" per request (evlog), with who called, what they did, and why it failed.
    // On Workers it prints JSON to the console, which Workers Logs indexes and lets you query.
    modules: [
      evlog({
        env: { service: "drop" },
        exclude: ["/_drop-ui/**", "/_fonts/**", "/vendor/**", "/favicon.svg", "/__nuxt_error"],
        redact: { paths: ["**.key", "**.secret", "**.password"] },
      }),
    ],
    cloudflare: {
      wrangler: {
        name: cloudflareTemplate.name,
        observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: true } },
        // A page waits on D1 queries one after another, each a round trip from wherever the Worker runs. Smart
        // Placement runs it near the database when that's faster; static assets are still served from the edge.
        placement: { mode: "smart" },
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
    ...["oauth-protected-resource", "oauth-authorization-server", "openid-configuration"].flatMap((name) => [
      { route: `/.well-known/${name}`, handler: oauthMetadataHandler, lazy: true },
      { route: `/.well-known/${name}/**`, handler: oauthMetadataHandler, lazy: true },
    ]),
  ],

  hooks: {
    "nitro:init": function (nitro) {
      if (host === "cloudflare")
        nitro.hooks.hook("compiled", () => syncCloudflareTemplate(nitro.options.output.serverDir))
    },
    // The CLI nightly adds a dev-only socket-cleanup plugin from @nuxt/cli, which this Nuxt nightly's
    // server import protection rejects. Dev works without it.
    "nitro:config": function (config) {
      config.plugins = config.plugins?.filter((plugin) => !plugin.includes("dev-close-sockets"))
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
          // Emails of the admins, comma-separated. Whoever signs in with one of them, verified by any sign-in method, is an admin.
          admins: env({ secret: true, source: env.source("DROP_ADMINS") }),
          // personal: drops start private and share by public link. team: everyone signed in is a teammate, drops start
          // shared with the team, and admins keep the team's folders (shared/share.ts).
          mode: env.enum(["personal", "team"], { source: env.source("DROP_MODE"), default: "personal" }),
          // Days a public link stays open: empty for the mode's default (team 7, personal until changed), 0 turns them off.
          publicLinkDays: env({ source: env.source("DROP_PUBLIC_LINK_DAYS"), default: "" }),
          // Only active members of this GitHub organization may sign in, open shared links, or use MCP.
          // Emails of the only people who may sign in, open shared links, or use MCP, comma-separated; admins always may.
          // Verified by any sign-in method, like DROP_ADMINS. Empty lets anyone in.
          members: env({ secret: true, source: env.source("DROP_MEMBERS"), default: "" }),
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
  },
})
