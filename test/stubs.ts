import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite-plus"

const root = fileURLToPath(new URL("../", import.meta.url))
const ocache = createRequire(import.meta.resolve("nitro/package.json")).resolve("ocache")
const identity =
  "export const identify = async () => globalThis.dropTest.who; export const requireIdentity = async () => { if (!globalThis.dropTest.who) throw Object.assign(new Error('Sign in'), { status: 401 }); return globalThis.dropTest.who }; export const roleOf = person => (globalThis.dropTest.admins ?? '').split(',').includes(person.email) ? 'admin' : 'member'; export const syncRole = async () => {}"
// Server modules Drop reads from Nitro and ViteHub at runtime, backed by test/cost/harness.mjs's `globalThis.dropTest`.
const stubs: Record<string, string> = {
  "vite-hub/database/drizzle": "export const db = globalThis.dropTest.db",
  "vite-hub/database": "export const defineDatabase = v => v",
  "vite-hub/blob": "export const blob = globalThis.dropTest.blob",
  // Nitro's own cache runtime (ocache), on the test storage. unstorage's "cache" mount drops the base and turns "/" into ":".
  "nitro/cache": `import { defineCachedFunction as define, setStorage } from ${JSON.stringify(ocache)}
const key = key => key.replace(/^\\/cache:/, "").replaceAll("/", ":")
setStorage({ get: k => globalThis.dropTest.storage.getItem(key(k)), set: (k, value, options) => globalThis.dropTest.storage.setItem(key(k), value, options?.ttl ? { ttl: options.ttl } : undefined) })
export const defineCachedFunction = (fn, options) => define(fn, { group: "nitro/functions", ...options })`,
  "nitro/storage": "export const useStorage = () => globalThis.dropTest.storage",
  "vite-hub/rate-limit":
    "export const requireRateLimit = async (_event, bucket, options) => { globalThis.dropTest.bursts.push({ bucket, ...options }); if (globalThis.dropTest.failBurst) throw Object.assign(new Error('burst limit'), { status: 429 }) }",
  "vite-hub/schedule": "export const defineSchedule = value => value",
  "#vitehub/env/server":
    "export const useServerEnv = () => { const t = globalThis.dropTest; return { drop: { shareApproval: t.shareApproval, contentOrigin: t.contentOrigin ?? '', expiryDays: t.expiryDays, customExpiry: t.customExpiry, mode: t.mode ?? 'personal', publicLinkDays: t.publicLinkDays ?? '', githubOrg: t.githubOrg ?? '', authProxy: t.authProxy ?? false, authProxyCookie: '', testSignin: false, admins: { unseal: () => t.admins ?? '' }, members: { unseal: () => t.members ?? '' }, quotas: { enabled: t.quotasEnabled, plan: 'free', proDrops: 100, proBytes: 1073741824, proWrites: 10000 } }, ...(t.authSecret ? { auth: { secret: { unseal: () => t.authSecret } } } : {}) } }",
  "#code-image-png": "export const PNG_CODE_IMAGES = false; export const renderCodePng = async () => new Blob(['png'])",
  "#live-drafts":
    "export const LIVE_EDITING = false; export const ensureDraft = async id => `drafts/${id}.md`; export const readDraft = async () => null; export const deleteDrafts = async () => {}",
}
// With DROP_TEST_BASELINE=<ref>, these files load as they were at that commit, to compare a change against it.
const baseline = new Set([
  "server/utils/drops.ts",
  "server/middleware/0.drop-access.ts",
  "server/middleware/1.markdown-documents.ts",
  "server/api/me.get.ts",
  "server/utils/code-image-store.ts",
])
const PREFIX = "\0drop-stub:"

/** Swaps the runtime modules server code imports for test doubles. Tests import the real packages directly. */
export function dropTestStubs(): Plugin {
  return {
    name: "drop-test-stubs",
    enforce: "pre",
    // Only under Vitest, so no other Vite run that loads vite.config.ts ever ships a stub.
    apply: () => Boolean(process.env.VITEST),
    resolveId(id, importer) {
      if (!importer || importer.startsWith(`${root}test/`)) return
      if (id in stubs || id.endsWith("/utils/identity") || id === "./identity")
        return PREFIX + (id in stubs ? id : "identity")
      if (id.startsWith("#shared/")) return this.resolve(`${root}shared/${id.slice(8)}`, importer)
    },
    load(id) {
      if (id.startsWith(PREFIX)) {
        const name = id.slice(PREFIX.length)
        return name === "identity" ? identity : stubs[name]
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
