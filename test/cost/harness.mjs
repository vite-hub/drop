import { DatabaseSync } from "node:sqlite"
import { d1Codecs } from "drizzle-orm/d1/codecs"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { H3Event } from "h3"
import { installComments } from "vite-hub/comments/server"
import { migrationSql } from "../migrations.mjs"

export const sql = new DatabaseSync(":memory:")
export const queries = []
/** One query for Drizzle's SQLite proxy: `get` answers a row, `all` the rows, as arrays unless it asks for objects. */
const run = (query, params, method, rowMode = "array") => {
  queries.push({ query, params })
  const statement = sql.prepare(query)
  if (method === "run" || !statement.columns().length) {
    statement.run(...params)
    return method === "all" ? [] : method === "get" ? undefined : { rows: [] }
  }
  statement.setReturnArrays(rowMode === "array")
  const rows = statement.all(...params)
  return method === "get" ? rows[0] : rows
}

// Each D1 query is a round trip from the Worker, ~6 ms from Milan where drop.vitehub.dev runs and ~40 ms from elsewhere.
// Queries that start together share one: while `roundTrips` runs, every query (or batch) waits for the current wave,
// which ends once nothing else can join it, so the count is the round trips a request waits for one after another.
let counting = false
let waves = 0
let wave
const nextWave = () =>
  (wave ??= new Promise((resolve) =>
    setImmediate(() => {
      waves++
      wave = undefined
      resolve()
    }),
  ))
const waited = async () => {
  if (counting) await nextWave()
}
/** How many database round trips `request` waited for one after another. */
export async function roundTrips(request) {
  counting = true
  try {
    await nextWave()
    const start = waves
    await request()
    return waves - start
  } finally {
    counting = false
  }
}

const executor = (method) => async (query, params, rowMode) => {
  await waited()
  return run(query, params, method, rowMode)
}
// Raw SQLite values, as D1 returns them, so D1's codecs read them (JSON columns, booleans, timestamps), as in production.
const db = drizzle(
  {
    get: executor("get"),
    all: executor("all"),
    run: executor("run"),
    batch: async (batch) => {
      await waited()
      sql.exec("BEGIN")
      try {
        const result = batch.map((item) => run(item.sql, item.params, item.method, item.rowMode))
        sql.exec("COMMIT")
        return result
      } catch (error) {
        sql.exec("ROLLBACK")
        throw error
      }
    },
  },
  { codecs: d1Codecs },
)
// Match D1's raw all() results, which return named columns instead of proxy arrays.
db.all = async (query) => {
  await waited()
  const compiled = db.dialect.sqlToQuery(query)
  queries.push({ query: compiled.sql, params: compiled.params })
  return sql.prepare(compiled.sql).all(...compiled.params)
}
/** SQLite's plan for a query `queries` recorded, one step a line. */
export const planOf = ({ query, params }) =>
  sql
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...params)
    .map((row) => row.detail)
    .join("\n")
export const objects = new Map()
const entries = new Map()
export const calls = { get: 0, head: 0, del: 0, serve: 0, writes: [] }
// The stubs in test/stubs.ts hand this state to the server code under test.
export const state = (globalThis.dropTest = {
  db,
  who: null,
  objects,
  entries,
  bursts: [],
  failBurst: false,
  ogRenders: [],
  refreshedLinks: [],
  ogBrowser: true,
  failDelete: false,
  failServe: false,
  failCacheDelete: false,
  blob: {
    list: async () => [null, { blobs: [...objects.keys()].map((pathname) => ({ pathname })) }],
    get: async (key) => {
      calls.get++
      return [null, objects.get(key)?.body ?? null]
    },
    head: async (key) => {
      calls.head++
      const file = objects.get(key)
      return [null, file ? { ...file, size: file.body?.size ?? file.size } : null]
    },
    // Like ViteHub's serve(): a Response with the file, or the one range asked for, a 404 for a missing file, and a
    // thrown error when storage fails.
    serve: async (request, key, options = {}) => {
      calls.serve++
      const body = objects.get(key)?.body
      if (!body) return new Response(null, { status: 404 })
      if (state.failServe) throw Object.assign(new Error("injected blob serve failure"), { code: "BLOB_R0001" })
      const etag = `"${key}"`
      const headers = new Headers({
        ETag: etag,
        "Cache-Control": options.cacheControl ?? "private, no-cache",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": body.type || "application/octet-stream",
      })
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
      const ifRange = request.headers.get("if-range")
      const range =
        ifRange === null || ifRange === etag ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "") : null
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Number(range[2]) : body.size - 1
      if (range) headers.set("Content-Range", `bytes ${start}-${end}/${body.size}`)
      headers.set("Content-Length", String(end - start + 1))
      const part = request.method === "HEAD" ? null : body.slice(start, end + 1).stream()
      return new Response(part, { status: range ? 206 : 200, headers })
    },
    put: async (key, body) => {
      objects.set(key, { body: new Blob([body]), uploadedAt: new Date() })
      return [null, { url: `/f/${key}` }]
    },
    delete: async (keys) => {
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
const { default: comments } = await import("../../server/comments.ts")
/**
 * Applies the migrations, and gives Drop's Comments (server/comments.ts) the database, as ViteHub does at start.
 * `comments: false` leaves Comments without one, as a server whose ViteHub plugin found no Database.
 */
export function migrate({ comments: install = true } = {}) {
  for (const migration of migrationSql()) sql.exec(migration)
  if (install) installComments(comments, { database: state.db })
}
const authorOf = (row) => ({
  id: row.author_id,
  ...(row.author_name ? { name: row.author_name } : {}),
  ...(row.author_image ? { image: row.author_image } : {}),
  ...(row.author_id.startsWith("guest:") ? { guest: true } : {}),
})
/** Every comment thread, by scope and number, with its JSON fields read. */
export const threads = () =>
  sql
    .prepare("SELECT * FROM vitehub_comment_threads ORDER BY scope, n")
    .all()
    .map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata),
      anchor: JSON.parse(row.anchor),
      author: authorOf(row),
      messages: sql
        .prepare("SELECT * FROM vitehub_comment_messages WHERE thread_id = ? ORDER BY created_at, id")
        .all(row.id)
        .map((message) => ({
          ...message,
          author: authorOf(message),
          mentions: JSON.parse(message.mentions),
          attachments: JSON.parse(message.attachments),
        })),
    }))
export function event(path, method = "GET") {
  const request = new H3Event(new Request(`https://drop.example${path}`, { method, headers: { accept: "text/html" } }))
  request.context.log = { set() {}, error() {} }
  return request
}
export function reset() {
  sql.exec(
    "DELETE FROM quota_reservations; DELETE FROM abuse_reports; DELETE FROM drop_files; DELETE FROM vitehub_comment_messages; DELETE FROM vitehub_comment_threads; DELETE FROM vitehub_comment_counters; DELETE FROM drops; DELETE FROM drop_views; DELETE FROM drop_viewers; DELETE FROM blob_cleanup; DELETE FROM comment_cleanup; DELETE FROM code_images; DELETE FROM member; DELETE FROM invitation; DELETE FROM subscription; DELETE FROM organization; DELETE FROM user",
  )
  state.bursts.length = 0
  state.failBurst = false
  state.ogRenders.length = 0
  state.refreshedLinks.length = 0
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
  state.failServe = false
  state.failCacheDelete = false
  state.who = null
  state.draft = null
  objects.clear()
  entries.clear()
  queries.length = 0
  calls.get = calls.head = calls.del = calls.serve = 0
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

/** An earlier version of drop `id`, as publishing a later one leaves it in `drop_versions`. */
export function insertVersion(id, version, overrides = {}) {
  const values = {
    drop_id: id,
    version,
    kind: "markdown",
    title: `${id} v${version}`,
    filename: `${id}.md`,
    blob_key: `${id}-v${version}.md`,
    size: 8,
    actor_kind: "browser",
    actor_name: "Owner",
    created_at: version,
    ...overrides,
  }
  const keys = Object.keys(values)
  sql
    .prepare(`INSERT INTO drop_versions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...Object.values(values))
  if (values.blob_key) objects.set(values.blob_key, { body: new Blob(["# Source"]), uploadedAt: new Date() })
}
