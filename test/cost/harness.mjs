import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { H3Event } from "h3"

const root = new URL("../../", import.meta.url)

export const sql = new DatabaseSync(":memory:")
export const queries = []
const execute = async (query, params, method) => {
  queries.push({ query, params })
  const statement = sql.prepare(query)
  if (method === "run" || !statement.columns().length) {
    statement.run(...params)
    return { rows: [] }
  }
  statement.setReturnArrays(true)
  const rows = statement.all(...params)
  return { rows: method === "get" ? rows[0] : rows }
}
const db = drizzle(execute, async (queries) => {
  sql.exec("BEGIN")
  try {
    const result = []
    for (const item of queries) result.push(await execute(item.sql, item.params, item.method))
    sql.exec("COMMIT")
    return result
  } catch (error) {
    sql.exec("ROLLBACK")
    throw error
  }
})
// Match D1's raw all() results, which return named columns instead of proxy arrays.
db.all = async (query) => {
  const compiled = db.dialect.sqlToQuery(query)
  queries.push({ query: compiled.sql, params: compiled.params })
  return sql.prepare(compiled.sql).all(...compiled.params)
}
export const objects = new Map()
const entries = new Map()
export const calls = { get: 0, head: 0, del: 0, writes: [] }
// The stubs in test/stubs.ts hand this state to the server code under test.
export const state = (globalThis.dropTest = {
  db,
  who: null,
  objects,
  entries,
  bursts: [],
  failBurst: false,
  ogRenders: [],
  ogBrowser: true,
  failDelete: false,
  failCacheDelete: false,
  blob: {
    list: async () => [null, { blobs: [...objects.keys()].map((pathname) => ({ pathname })) }],
    get: async (key) => {
      calls.get++
      return [null, objects.get(key)?.body ?? null]
    },
    head: async (key) => {
      calls.head++
      return [null, objects.get(key) ?? null]
    },
    put: async (key, body) => {
      objects.set(key, { body: new Blob([body]), uploadedAt: new Date() })
      return [null, { url: `/f/${key}` }]
    },
    del: async (keys) => {
      calls.del++
      if (state.failDelete) return [new Error("injected blob delete failure")]
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
      return [null]
    },
  },
  storage: {
    getItem: async (key) => entries.get(key) ?? null,
    getItemRaw: async (key) => entries.get(key) ?? null,
    setItemRaw: async (key, value, options) => {
      calls.writes.push({ key, value, options })
      entries.set(key, value)
    },
    setItem: async (key, value, options) => {
      calls.writes.push({ key, value, options })
      entries.set(key, value)
    },
    removeItem: async (key) => {
      if (state.failCacheDelete) throw new Error("cache delete failure")
      entries.delete(key)
    },
  },
})
export function migrate() {
  const directory = new URL("server/databases/migrations/", root)
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL(name, directory), "utf8"))
}
export function event(path, method = "GET") {
  const request = new H3Event(new Request(`https://drop.example${path}`, { method }))
  request.context.log = { set() {}, error() {} }
  return request
}
export function reset() {
  sql.exec(
    "DELETE FROM quota_reservations; DELETE FROM quota_blobs; DELETE FROM abuse_reports; DELETE FROM drop_files; DELETE FROM comments; DELETE FROM drops; DELETE FROM drop_views; DELETE FROM drop_viewers; DELETE FROM drop_resources; DELETE FROM blob_cleanup; DELETE FROM code_images; DELETE FROM member; DELETE FROM invitation; DELETE FROM subscription; DELETE FROM organization; DELETE FROM user",
  )
  state.bursts.length = 0
  state.failBurst = false
  state.ogRenders.length = 0
  state.ogBrowser = true
  state.quotasEnabled = false
  state.shareApproval = false
  state.expiryDays = 30
  state.customExpiry = true
  state.mode = "personal"
  state.teams = false
  state.billing = false
  state.freeKept = 10
  state.publicLinkDays = ""
  state.admins = ""
  state.failDelete = false
  state.failCacheDelete = false
  state.who = null
  objects.clear()
  entries.clear()
  queries.length = 0
  calls.get = calls.head = calls.del = 0
  calls.writes.length = 0
  sql.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run("owner", "Owner", "owner@example.com")
}
export const who = {
  userId: "owner",
  name: "Owner",
  email: "owner@example.com",
  image: null,
  role: "member",
  actorKind: "browser",
  actorName: "Owner",
}
/** The share a test means by the old pair: shared is public (view) or public_comment, team with edit access is team_edit. */
const shareOf = ({ visibility, access }) =>
  visibility === "team"
    ? access === "edit"
      ? "team_edit"
      : "team"
    : visibility === "private"
      ? "private"
      : access === "view"
        ? "public"
        : "public_comment"
export function insertDrop(id, { visibility, access, ...overrides } = {}) {
  const values = {
    id,
    owner_id: "owner",
    kind: "markdown",
    title: id,
    filename: `${id}.md`,
    blob_key: `${id}.md`,
    size: 8,
    version: 1,
    share: shareOf({ visibility, access }),
    actor_kind: "browser",
    actor_name: "Owner",
    created_at: 1,
    updated_at: 1,
    // A fresh window, as if someone opened the drop just now.
    last_accessed_at: Date.now(),
    ...overrides,
  }
  const keys = Object.keys(values)
  sql
    .prepare(`INSERT INTO drops (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...Object.values(values))
  if (values.blob_key) objects.set(values.blob_key, { body: new Blob(["# Source"]), uploadedAt: new Date() })
}
