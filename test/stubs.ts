import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite-plus"

const root = fileURLToPath(new URL("../", import.meta.url))
const ocache = createRequire(import.meta.resolve("nitro/package.json")).resolve("ocache")
// Drop modules swapped by their file name, wherever they're imported from.
const modules: Record<string, string> = {
  identity:
    "export const identify = async () => globalThis.dropTest.who; export const requireIdentity = async () => { if (!globalThis.dropTest.who) throw Object.assign(new Error('Sign in'), { status: 401 }); return globalThis.dropTest.who }; export const requireAdmin = async () => { const who = globalThis.dropTest.who; if (who?.role !== 'admin' || who.actorKind !== 'browser') throw Object.assign(new Error('Only admins'), { status: 403 }); return who }; export const roleOf = person => (globalThis.dropTest.admins ?? '').split(',').includes(person.email) ? 'admin' : 'member'; export const syncRole = async id => { await globalThis.dropTest.syncRole?.(id) }; export const authFor = () => globalThis.dropTest.auth; export const sessionOf = async event => { const { headers, response } = await authFor().api.getSession({ headers: event.req.headers, returnHeaders: true }); const cookies = headers.getSetCookie(); if (cookies.length) (event.context.dropSessionCookies ??= []).push(...cookies); return response }; export const identityOf = async id => globalThis.dropTest.identities?.[id] ?? null; export const bearerFrom = headers => headers.get('authorization')?.match(/^Bearer\\s+(\\S+)$/i)?.[1] ?? null",
  "code-image-png":
    "export const PNG_CODE_IMAGES = false; export const renderCodePng = async () => new Blob(['png']); export const renderOgPng = async (_event, page) => { globalThis.dropTest.ogRenders.push(page); return globalThis.dropTest.ogBrowser ? new Blob(['card']) : null }",
  "live-drafts":
    "export const LIVE_EDITING = false; export const ensureDraft = async drop => `drafts/${drop.id}/v${drop.version}.md`; export const readDraft = async () => globalThis.dropTest.draft ?? null; export const deleteDrafts = async () => {}; export const refreshLatest = async id => { globalThis.dropTest.refreshedLinks.push(id) }",
}
// Server modules Drop reads from Nitro and ViteHub at runtime, backed by test/cost/harness.mjs's `globalThis.dropTest`.
const stubs: Record<string, string> = {
  // ViteHub's real helpers, on the test database: a copy with no Databases of its own reads them from this global.
  "vite-hub/database": `globalThis[Symbol.for("vitehub.database.runtime")] = () => ({ databases: { default: { db: globalThis.dropTest.db } }, configured: new Set(["default"]) })
export { chunkParameters, withIdempotency } from "@vite-hub/database"
export const db = globalThis.dropTest?.db; export const defineDatabase = v => v`,
  "vite-hub/blob":
    'export { detectContentType } from "@vite-hub/blob/client"; export const blob = globalThis.dropTest.blob',
  // Nitro's own cache runtime (ocache), on the test storage. unstorage's "cache" mount drops the base and turns "/" into ":".
  "nitro/cache": `import { defineCachedFunction as define } from ${JSON.stringify(ocache)}
const key = key => key.replace(/^\\/cache:/, "").replaceAll("/", ":")
const storage = () => ({ get: k => globalThis.dropTest.storage.getItem(key(k)), set: (k, value, options) => globalThis.dropTest.storage.setItem(key(k), value, options?.ttl ? { ttl: options.ttl } : undefined) })
export const defineCachedFunction = (fn, options) => define(fn, { storage, group: "nitro/functions", ...options })`,
  "nitro/storage": "export const useStorage = () => globalThis.dropTest.storage",
  // Like ViteHub's: a 429 says Retry-After only when the limiter knows it. `burstRetryAfter: undefined` is
  // Cloudflare's binding, which doesn't.
  "vite-hub/rate-limit": `import { HTTPError } from "h3"
export const checkRateLimit = async (_event, bucket, options) => {
  globalThis.dropTest.bursts.push({ bucket, ...options })
  const retryAfter = "burstRetryAfter" in globalThis.dropTest ? globalThis.dropTest.burstRetryAfter : 42
  return [undefined, globalThis.dropTest.failBurst ? { allowed: false, reason: "limited", retryAfter, limit: options.limit, windowMs: 60000 } : { allowed: true, limit: options.limit, windowMs: 60000 }]
}
export const requireRateLimit = async (...args) => {
  const [, decision] = await checkRateLimit(...args)
  if (decision.allowed) return
  throw new HTTPError({ status: 429, statusText: "Too Many Requests", message: args[2].message ?? "Rate limit exceeded.", headers: decision.retryAfter === undefined ? undefined : { "Retry-After": String(decision.retryAfter) } })
}`,
  "vite-hub/schedule": "export const defineSchedule = value => value",
  // The hourly cleanup's MCP client sweep needs the app's Auth, which tests don't build; it only counts the calls.
  "vite-hub/auth/mcp":
    "export const deleteUnusedMcpClients = async () => { globalThis.dropTest.mcpCleanups = (globalThis.dropTest.mcpCleanups ?? 0) + 1; return [undefined, { deleted: 0 }] }",
  // ViteHub Auth's VITEHUB_MEMBERS check, on the test's emails: `state.members` lists them, empty lets everyone in.
  "vite-hub/auth/server": `import { sql } from "drizzle-orm"
export const checkAuthMember = async (userId) => {
  const listed = (globalThis.dropTest.members ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  if (!listed.length) return [undefined, undefined]
  if (globalThis.dropTest.memberCheckError) return [{ code: globalThis.dropTest.memberCheckError }, undefined]
  const [row] = await globalThis.dropTest.db.all(sql\`SELECT email FROM user WHERE id = \${userId}\`)
  return row && listed.includes(row.email.toLowerCase()) ? [undefined, undefined] : [{ code: "AUTH_NOT_MEMBER" }, undefined]
}
// requireCaller: a bearer token is \`dropTest.mcpCaller\`'s, or refused with \`dropTest.mcpRefusal\`, else the session of \`dropTest.authApi\`.
export const requireCaller = async (event) => {
  const headers = event.req.headers
  if (/^Bearer\\s+\\S+$/i.test(headers.get("authorization") ?? "")) {
    const caller = globalThis.dropTest.mcpCaller
    if (!caller) return [globalThis.dropTest.mcpRefusal ?? { code: "AUTH_MCP_TOKEN_INVALID", message: "invalid token" }, undefined]
    return [undefined, { kind: "agent", user: caller.user, client: { id: caller.clientId ?? "client", name: caller.clientName }, scopes: caller.scopes ?? [] }]
  }
  const { headers: responseHeaders, response: session } = await useAuth(event).api.getSession({ headers, returnHeaders: true })
  for (const cookie of responseHeaders.getSetCookie()) event.res.headers.append("Set-Cookie", cookie)
  return session?.user ? [undefined, { kind: "browser", user: session.user, session: session.session ?? {} }] : [{ code: "AUTH_SIGNED_OUT" }, undefined]
}
// A test that needs Better Auth's API sets \`dropTest.authApi\`; the rest build Better Auth themselves.
export const useAuth = () => {
  if (!globalThis.dropTest.authApi) throw new Error("Tests build Better Auth themselves")
  return { api: globalThis.dropTest.authApi }
}
export default () => new Response(null, { status: 404 })`,
  "vite-hub/realtime/server":
    "export const isRealtimeAvailable = () => true; export const refreshRealtimeDocument = async () => true; export const blobDocument = () => ({ kind: 'blob' })",
  "vite-hub/env": `const optionalSecret = (value) => value ? { unseal: () => value } : undefined;
    export const deriveSecret = async (purpose) => \`test-secret:\${purpose}\`;
    export const useServerEnv = () => {
      const t = globalThis.dropTest;
      const billing = t.billing === true ? { stripeSecretKey: 'sk_test', stripeWebhookSecret: 'whsec_test', priceId: 'price_team' } : t.billing || {};
      return { drop: { shareApproval: t.shareApproval, contentOrigin: t.contentOrigin ?? '', expiryDays: t.expiryDays, customExpiry: t.customExpiry, mode: t.mode ?? 'personal', publicLinkDays: t.publicLinkDays ?? '', authProxy: t.authProxy ?? false, authProxyCookie: t.authProxyCookie ?? '', testSignin: false, admins: { unseal: () => t.admins ?? '' }, members: optionalSecret(t.members), quotas: { enabled: t.quotasEnabled, plan: 'free', proDrops: undefined, proBytes: 1073741824, proWrites: 10000, freeKept: t.freeKept ?? 10 }, teams: t.teams ?? false, billing: { stripeSecretKey: optionalSecret(billing.stripeSecretKey), stripeWebhookSecret: optionalSecret(billing.stripeWebhookSecret), priceId: billing.priceId ?? '', annualPriceId: '', freeMembers: 3, managedPayments: true } }, ...(t.authSecret ? { auth: { secret: { unseal: () => t.authSecret } } } : {}) };
    };`,
}
// The client IP header nuxt.config sets for the host, VPS unless a test sets `dropTest.clientIpHeader`. Only for
// client-address.ts, so tests that vi.mock nitro/runtime-config still get their mock.
const clientAddressConfig =
  'export const useRuntimeConfig = () => ({ clientIpHeader: globalThis.dropTest?.clientIpHeader ?? "x-forwarded-for" })'
// With DROP_TEST_BASELINE=<ref>, these files load as they were at that commit, to compare a change against it.
const baseline = new Set([
  "server/utils/drops.ts",
  "server/middleware/0.drop-access.ts",
  "server/middleware/1.markdown-documents.ts",
  "server/api/me.get.ts",
  "server/utils/code-image-store.ts",
])
const PREFIX = "\0drop-stub:"
// By stub name, which has no `?raw` for Vite to see: the import, and the file relative to the workspace root.
const rawCss: Record<string, [string, string]> = {
  "comments-css": ["comark-comments/style.css?raw", "node_modules/comark-comments/dist/style.css"],
  "comment-marks-css": ["@vite-hub/ui/comment-marks.css?raw", "node_modules/@vite-hub/ui/dist/comment-marks.css"],
  "copy-icon-css": ["./copy-icon.css?raw", "shared/copy-icon.css"],
}

/** Swaps the runtime modules server code imports for test doubles. Tests import the real packages directly. */
export function dropTestStubs(): Plugin {
  return {
    name: "drop-test-stubs",
    enforce: "pre",
    // Only under Vitest, so no other Vite run that loads vite.config.ts ever ships a stub.
    apply: () => Boolean(process.env.VITEST),
    resolveId(id, importer) {
      if (!importer || importer.startsWith(`${root}test/`)) return
      // Vitest empties CSS `?raw` imports; the frame's browser tests need the real stylesheets.
      const css = Object.entries(rawCss).find(([, [specifier]]) => specifier === id)
      if (css) return PREFIX + css[0]
      if (id === "nitro/runtime-config" && importer === `${root}server/utils/client-address.ts`)
        return `${PREFIX}client-address-config`
      if (id in stubs && importer !== `${root}nuxt.config.ts`) return PREFIX + id
      const module = Object.keys(modules).find(
        (name) => id.endsWith(`/utils/${name}`) || id === `./${name}` || id === `../${name}`,
      )
      if (module) return PREFIX + module
      if (id.startsWith("#shared/")) return this.resolve(`${root}shared/${id.slice(8)}`, importer)
    },
    load(id) {
      if (id.startsWith(PREFIX)) {
        const name = id.slice(PREFIX.length)
        const css = rawCss[name]
        if (css) return `export default ${JSON.stringify(readFileSync(`${root}${css[1]}`, "utf8"))}`
        if (name === "client-address-config") return clientAddressConfig
        return modules[name] ?? stubs[name]
      }
      const ref = process.env.DROP_TEST_BASELINE
      const path = id.startsWith(root) ? id.slice(root.length) : ""
      if (!ref || !baseline.has(path)) return
      const source = execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" })
      // Let the new gate call the old middleware's lookup without introducing its owner join.
      return path === "server/utils/drops.ts"
        ? `${source}\nexport async function findDropByBlob(key) { const [row] = await db.select().from(drops).where(eq(drops.blobKey, key)).limit(1); return row ?? null }\n`
        : source
    },
  }
}
