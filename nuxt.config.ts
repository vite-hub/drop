import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { readForgeBuild } from "@vite-hub/forge/build/node"
import evlog from "evlog/nitro/v3"
import type { NuxtConfig } from "nuxt/schema"
import type { NuxtSecurityRouteRules } from "nuxt-security"
import { env } from "vite-hub/env"
import { CLIENT_IP_HEADERS, VIEWER_IP_HEADERS } from "./shared/client-ip.ts"
import { DROP_PAGE_ROUTES } from "./shared/csp.ts"
import { DEFAULT_EXPIRY_DAYS } from "./shared/expiry.ts"
import { ROBOTS_DISALLOW } from "./shared/robots.ts"
import { DEFAULT_FREE_KEPT, DEFAULT_FREE_TEAM_MEMBERS, DEFAULT_PRO_LIMITS, PLANS } from "./shared/quotas.ts"
import { cloudflareTemplate } from "./scripts/cloudflare-template.ts"
import { deployment, type Host } from "./scripts/deployment.ts"
import { legacyViteHubRoutes } from "./scripts/legacy-vitehub-routes.ts"
import { evlogOptions } from "./scripts/logging.ts"

declare module "nuxt/schema" {
  interface RouteRuleConfigExtensions {
    security?: NuxtSecurityRouteRules
  }
}

const contentErrorHandler = fileURLToPath(new URL("./server/handlers/content-error.ts", import.meta.url))

const { host, database } = deployment()
if (!process.env.VITEHUB_HOST && process.env.DROP_HOST) process.env.VITEHUB_HOST = host === "vps" ? "node" : host
const databaseOnlyHealth = host === "vps" || host === "deno"
const healthRoute = "/api/health"

const release = {
  version: JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
  commit: (await readForgeBuild(fileURLToPath(new URL(".", import.meta.url)))).commit ?? "",
}
const liveEditing = host === "cloudflare" || host === "vps"

const files = {
  serve: { route: "/f", authorize: true, anonymous: true, headers: { "Cache-Control": "private, no-cache" } },
} as const

const HOSTED_D1 = "d634358e-4605-45ca-970f-d390584795a5"

const d1 = (fallback: string) => ({
  driver: "cloudflare" as const,
  databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || fallback,
  databaseId: env({ source: env.source("CLOUDFLARE_D1_DATABASE_ID") }),
  cloudflare: { http: true },
})

const VITEHUB: Record<Host, NonNullable<NuxtConfig["vitehub"]>> = {
  cloudflare: {
    host: "cloudflare",
    blob:
      process.env.CLOUDFLARE_D1_DATABASE_ID === HOSTED_D1
        ? { ...files, binding: "BLOB_EEUR", bucketName: "vitehub-drop-eeur" }
        : files,
    browser: true,
    database: {
      driver: "cloudflare",
      databaseName: process.env.CLOUDFLARE_D1_DATABASE_NAME || cloudflareTemplate.d1_databases[0]!.database_name,
      databaseId:
        process.env.CLOUDFLARE_D1_DATABASE_ID ||
        cloudflareTemplate.d1_databases[0]!.database_id ||
        "00000000-0000-4000-8000-000000000000",
      readReplication: true,
      migrateOnDeploy: true,
    },
    kv: true,
    cache: { driver: "kv" },
    rateLimit: true,
    schedule: true,
    realtime: { driver: "cloudflare" },
  },
  vercel: {
    host: "vercel",
    blob: { ...files, driver: "vercel", access: "private" },
    database: d1("vitehub-drop-vercel"),
    schedule: { cron: { cleanup: "0 0 * * *" } },
    realtime: false,
  },
  netlify: {
    host: "netlify",
    blob: files,
    database: d1("vitehub-drop-netlify"),
    schedule: true,
    realtime: false,
  },
  deno: {
    host: "deno",
    blob: {
      ...files,
      driver: "s3",
      bucket: process.env.S3_BUCKET || "drop",
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "auto",
    },
    database: d1("vitehub-drop-deno"),
    schedule: false,
    realtime: false,
  },
  vps: {
    host: "node",
    blob: { ...files, driver: "fs", base: ".data/blob" },
    database:
      database === "sqlite"
        ? {
            connection: {
              url: env({ source: env.source("DROP_DATABASE_URL"), default: "file:.data/database/drop.db" }),
            },
            migrateOnStart: { backup: true },
          }
        : { ...d1("vitehub-drop-vps"), migrateOnStart: true },
    kv: { driver: "fs-lite", base: ".data/kv" },
    rateLimit: { driver: "memory" },
    schedule: { runtime: { driver: "process" } },
    realtime: { driver: "memory" },
  },
}

type RouteRule = NonNullable<NuxtConfig["routeRules"]>[string]

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

  vitehub: {
    ...VITEHUB[host],
    publicUrl: process.env.DROP_PUBLIC_URL || undefined,
    trustProxy: true,
    ...(!databaseOnlyHealth && { health: { route: healthRoute } }),
    sameOriginWrites: { exclude: ["/mcp"] },
    observability: { browserErrors: true },
    seo: { sitemap: { pages: false }, robots: { disallow: ROBOTS_DISALLOW } },
    auth: true,
    comments: { overlay: { presence: false } },
    console: { authorize: fileURLToPath(new URL("./server/console-authorize.ts", import.meta.url)) },
    env: {
      server: {
        auth: {
          github: {
            clientId: env({ secret: true, optional: true, source: env.source("GITHUB_CLIENT_ID") }),
            clientSecret: env({ secret: true, optional: true, source: env.source("GITHUB_CLIENT_SECRET") }),
          },
          secret: env({ secret: true, source: env.source("BETTER_AUTH_SECRET") }),
        },
        drop: {
          admins: env({ secret: true, source: env.source("DROP_ADMINS") }),
          mode: env.enum(["personal", "team"], { source: env.source("DROP_MODE"), default: "personal" }),
          publicLinkDays: env({ source: env.source("DROP_PUBLIC_LINK_DAYS"), default: "" }),
          members: env({ secret: true, optional: true, source: env.source("VITEHUB_MEMBERS", { canonical: false }) }),
          authProxy: env.boolean({ source: env.source("DROP_AUTH_PROXY"), default: false }),
          authProxyCookie: env({ source: env.source("DROP_AUTH_PROXY_COOKIE"), default: "" }),
          testSignin: env.boolean({ source: env.source("DROP_TEST_SIGNIN"), default: false }),
          shareApproval: env.boolean({ source: env.source("DROP_SHARE_APPROVAL"), default: false }),
          abuseEmail: env({ source: env.source("DROP_ABUSE_EMAIL"), default: "" }),
          expiryDays: env.number({ source: env.source("DROP_EXPIRY_DAYS"), default: DEFAULT_EXPIRY_DAYS }),
          customExpiry: env.boolean({ source: env.source("DROP_CUSTOM_EXPIRY"), default: true }),
          contentOrigin: env({ source: env.source("DROP_CONTENT_ORIGIN"), default: "" }),
          quotas: {
            enabled: env.boolean({ source: env.source("DROP_QUOTAS"), default: false }),
            plan: env.enum(PLANS, { source: env.source("DROP_DEFAULT_PLAN"), default: "free" }),
            proDrops: env.number({ optional: true, source: env.source("DROP_PRO_DROPS") }),
            proBytes: env.number({ source: env.source("DROP_PRO_BYTES"), default: DEFAULT_PRO_LIMITS.bytes }),
            proWrites: env.number({ source: env.source("DROP_PRO_WRITES"), default: DEFAULT_PRO_LIMITS.writes }),
            freeKept: env.number({ source: env.source("DROP_FREE_KEPT"), default: DEFAULT_FREE_KEPT }),
          },
          teams: env.boolean({ source: env.source("DROP_TEAMS"), default: false }),
          billing: {
            stripeSecretKey: env({ secret: true, optional: true, source: env.source("STRIPE_SECRET_KEY") }),
            stripeWebhookSecret: env({ secret: true, optional: true, source: env.source("STRIPE_WEBHOOK_SECRET") }),
            priceId: env({ source: env.source("STRIPE_TEAM_PRICE_ID"), default: "" }),
            annualPriceId: env({ source: env.source("STRIPE_TEAM_ANNUAL_PRICE_ID"), default: "" }),
            freeMembers: env.number({
              source: env.source("DROP_FREE_TEAM_MEMBERS"),
              default: DEFAULT_FREE_TEAM_MEMBERS,
            }),
            managedPayments: env.boolean({ source: env.source("STRIPE_MANAGED_PAYMENTS"), default: true }),
          },
        },
      },
    },
  },

  $development: {
    vitehub: { blob: { driver: "fs" } },
  },

  css: [
    "@fontsource-variable/geist",
    "@fontsource-variable/geist-mono",
    "@fontsource/instrument-serif/latin-400-italic.css",
    "~/assets/css/main.css",
  ],
  devtools: false,
  compatibilityDate: "2026-07-17",

  runtimeConfig: {
    release,
    deployment: { host },
    seoIndex: false,
    clientIpHeader: CLIENT_IP_HEADERS[host] ?? "",
    viewerIpHeader: VIEWER_IP_HEADERS[host] ?? "",
    public: { realtime: liveEditing },
  },

  security: {
    rateLimiter: false,
    requestSizeLimiter: false,
    xssValidator: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    removeLoggers: false,
    sri: false,
    headers: {
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      xFrameOptions: false,
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: { maxAge: 31536000, includeSubdomains: false },
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
        "upgrade-insecure-requests": false,
      },
    },
  },

  routeRules: {
    ...Object.fromEntries(DROP_PAGE_ROUTES.map((route) => [route, DROP_PAGE])),
    "/drops/**": { ...DROP_PAGE, ...SIGNED_IN },
    "/agents": SIGNED_IN,
    "/teams/**": SIGNED_IN,
    "/skills/**": SIGNED_IN,
    "/admin/**": SIGNED_IN,
    "/signin": { headers: { "cache-control": "private, no-store" } },
    "/docs/**": { appLayout: "docs" },
    "/terms": { appLayout: "docs" },
    "/acceptable-use": { appLayout: "docs" },
    "/abuse": { appLayout: "docs" },
    "/pricing": { appLayout: "docs" },
  },

  experimental: {
    typescriptPlugin: true,
    checkOutdatedBuildInterval: 2 * 60_000,
  },

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

  colorMode: { disableTransition: true },

  ui: {
    colorMode: true,
    fonts: false,
  },

  icon: {
    provider: "none",
    clientBundle: {
      scan: { globInclude: ["**/*.{vue,md}", "app.config.ts", "app/**/*.ts", "shared/**/*.ts"] },
    },
  },

  nitro: {
    ...(databaseOnlyHealth && {
      handlers: [
        {
          route: healthRoute,
          method: "GET",
          handler: fileURLToPath(new URL("./server/handlers/database-health.ts", import.meta.url)),
        },
      ],
    }),
    devStorage: { cache: { driver: "memory" } },
    modules: [evlog(evlogOptions(release)), legacyViteHubRoutes],
    cloudflare: {
      wrangler: {
        name: cloudflareTemplate.name,
        observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: true } },
        placement:
          process.env.CLOUDFLARE_D1_DATABASE_ID === HOSTED_D1 ? { region: "gcp:europe-west8" } : { mode: "smart" },
      },
    },
    publicAssets: [
      { baseURL: "/vendor/pdfjs/wasm", dir: "node_modules/pdfjs-dist/wasm", maxAge: 60 * 60 * 24 * 365 },
      { baseURL: "/vendor/medium-zoom", dir: "node_modules/medium-zoom/dist", maxAge: 60 * 60 * 24 * 365 },
    ],
  },

  hooks: {
    "nitro:config": function (config) {
      config.errorHandler = [contentErrorHandler, ...[config.errorHandler ?? []].flat()]
    },
  },
})
