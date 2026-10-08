import { registerHooks, stripTypeScriptTypes } from "node:module"
import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { H3Event } from "h3"

const root = new URL("../../", import.meta.url)
const module = code => `data:text/javascript,${encodeURIComponent(code)}`
const stubs = {
  "vite-hub/database/drizzle": "export const db = globalThis.dropTest.db",
  "vite-hub/database": "export const defineDatabase = v => v",
  "vite-hub/blob": "export const blob = globalThis.dropTest.blob",
  "nitro/cache": "export const defineCachedFunction = fn => fn",
  "nitro/storage": 'export const useStorage = () => globalThis.dropTest.storage',
  "vite-hub/rate-limit": "export const requireRateLimit = async () => {}",
  "#vitehub/env/server": 'export const useServerEnv = () => ({ drop: { shareApproval: globalThis.dropTest.shareApproval ?? "0" } })',
  "#code-image-png": "export const PNG_CODE_IMAGES = false; export const renderCodePng = async () => new Blob(['png'])",
}
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".css?raw"))
      return { format: "module", source: `export default ${JSON.stringify(readFileSync(new URL(url.replace(/\?raw$/, "")), "utf8"))}`, shortCircuit: true }
    if (process.env.DROP_TEST_BASELINE && url.startsWith(root.href)) {
      const path = url.slice(root.href.length)
      if (["server/utils/drops.ts", "server/middleware/0.drop-access.ts", "server/middleware/1.markdown-documents.ts", "server/api/me.get.ts", "server/utils/code-image-store.ts"].includes(path)) {
        let source = execFileSync("git", ["show", `${process.env.DROP_TEST_BASELINE}:${path}`], { cwd: fileURLToPath(root), encoding: "utf8" })
        // Let the new gate call the old middleware's lookup without introducing its owner join.
        if (path === "server/utils/drops.ts") source += '\nexport async function findDropByBlob(key) { const [row] = await db.select().from(drops).where(eq(drops.blobKey, key)).limit(1); return row ?? null }\n'
        return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true }
      }
    }
    return next(url, context)
  },
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: module(stubs[specifier]), shortCircuit: true }
    if (specifier.endsWith("/utils/identity") || specifier === "./identity")
      return { url: module("export const identify = async () => globalThis.dropTest.who"), shortCircuit: true }
    if (specifier.startsWith("#shared/")) return { url: new URL(`shared/${specifier.slice(8)}.ts`, root).href, shortCircuit: true }
    if (specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL)
      if (!url.pathname.endsWith(".ts") && existsSync(fileURLToPath(url) + ".ts"))
        return { url: url.href + ".ts", shortCircuit: true }
    }
    return next(specifier, context)
  },
})

export const sql = new DatabaseSync(":memory:")
export const queries = []
const execute = async (query, params, method) => {
  queries.push({ query, params })
  const statement = sql.prepare(query)
  if (method === "run" || !statement.columns().length) { statement.run(...params); return { rows: [] } }
  statement.setReturnArrays(true)
  const rows = statement.all(...params)
  return { rows: method === "get" ? rows[0] : rows }
}
const db = drizzle(execute, async queries => {
  sql.exec("BEGIN")
  try {
    const result = []
    for (const item of queries) result.push(await execute(item.sql, item.params, item.method))
    sql.exec("COMMIT")
    return result
  }
  catch (error) { sql.exec("ROLLBACK"); throw error }
})
const objects = new Map()
const entries = new Map()
export const calls = { get: 0, head: 0, del: 0, writes: [] }
export const state = globalThis.dropTest = {
  db, who: null, objects, entries, failDelete: false, failCacheDelete: false,
  blob: {
    get: async key => { calls.get++; return [null, objects.get(key)?.body ?? null] },
    head: async key => { calls.head++; return [null, objects.get(key) ?? null] },
    put: async (key, body) => { objects.set(key, { body: new Blob([body]), uploadedAt: new Date() }); return [null, { url: `/f/${key}` }] },
    del: async keys => {
      calls.del++
      if (state.failDelete) return [new Error("injected blob delete failure")]
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
      return [null]
    },
  },
  storage: {
    getItem: async key => entries.get(key) ?? null,
    setItem: async (key, value, options) => { calls.writes.push({ key, value, options }); entries.set(key, value) },
    removeItem: async key => { if (state.failCacheDelete) throw new Error("cache delete failure"); entries.delete(key) },
  },
}
export function migrate() {
  for (const name of ["0000_init", "0001_security_constraints", "0002_oauth_provider", "0003_content_gates", "0005_trust"])
    sql.exec(readFileSync(new URL(`server/databases/migrations/${name}.sql`, root), "utf8"))
}
export function event(path, method = "GET") {
  const request = new H3Event(new Request(`https://drop.example${path}`, { method }))
  request.context.log = { set() {}, error() {} }
  return request
}
export function reset() {
  sql.exec("DELETE FROM abuse_reports; DELETE FROM drop_files; DELETE FROM comments; DELETE FROM drops; DELETE FROM blob_cleanup; DELETE FROM blob_tombstones; DELETE FROM code_images; DELETE FROM user")
  state.shareApproval = "0"
  state.failDelete = false; state.failCacheDelete = false; state.who = null
  objects.clear(); entries.clear(); queries.length = 0
  calls.get = calls.head = calls.del = 0; calls.writes.length = 0
  sql.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run("owner", "Owner", "owner@example.com")
}
export const who = { userId: "owner", name: "Owner", email: "owner@example.com", image: null, role: "member", actorKind: "browser", actorName: "Owner" }
export function insertDrop(id, overrides = {}) {
  const values = {
    id, owner_id: "owner", kind: "markdown", title: id, filename: `${id}.md`, blob_key: `${id}.md`, size: 8,
    version: 1, visibility: "shared", access: "comment", actor_kind: "browser", actor_name: "Owner", created_at: 1, updated_at: 1,
    ...overrides,
  }
  const keys = Object.keys(values)
  sql.prepare(`INSERT INTO drops (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(values))
  if (values.blob_key) objects.set(values.blob_key, { body: new Blob(["# Source"]), uploadedAt: new Date() })
}
