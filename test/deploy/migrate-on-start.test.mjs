import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "vite-plus/test"
import { migrations as dropMigrations } from "../../scripts/migrations.mjs"

const require = createRequire(import.meta.resolve("vite-hub"))
const root = fileURLToPath(new URL("../../", import.meta.url))
const { hubDatabase } = await import(pathToFileURL(require.resolve("@vite-hub/database/vite")))
// The module that the start plugin imports. Its folder holds the exported registry.
const { ensureDatabaseMigrations } = await import(
  new URL("migrate-on-start.js", pathToFileURL(require.resolve("@vite-hub/database/runtime/registry")))
)

// The migrations module that a Node build of Drop on D1 ships (`vps` with `database: d1`), read by ViteHub's Vite plugin.
async function shippedMigrations() {
  const plugin = hubDatabase({
    driver: "cloudflare",
    databaseId: "test-database",
    cloudflare: { http: true },
    migrateOnStart: true,
  })
  await plugin.configResolved({ command: "build", plugins: [], root })
  const id = plugin.resolveId.handler("#vitehub/database/migrations")
  return JSON.parse((await plugin.load.handler(id)).replace(/^export default /, ""))
}

// A D1 HTTP client on a local SQLite database. D1 enforces foreign keys and runs each request in one transaction.
function d1Client(database) {
  const query = async (sql, params = []) => {
    if (/^\s*SELECT/i.test(sql) && !sql.trim().replace(/;$/, "").includes(";")) {
      return database.prepare(sql).all(...params)
    }
    database.exec("BEGIN")
    try {
      database.exec(sql)
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
    return []
  }
  return { migrationsTable: "d1_migrations", protocol: "d1-http", query, target: "test-database" }
}

const tables = (database) =>
  database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)

test("an empty D1 database takes every Drop migration when the server starts", async () => {
  const shipped = await shippedMigrations()
  const files = shipped.databases.default.d1.files
  // ViteHub's data-loss check flags these files alone. Before vite-hub/vitehub#5487 that refused the start.
  assert.deepEqual(
    files.filter((file) => file.dataLoss.length).map((file) => file.name),
    ["0004_drop_comments_on_vitehub.sql", "0009_drop_comments_release_upgrade.sql"],
  )

  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  const client = d1Client(database)
  const log = []
  const info = console.info
  console.info = (message) => log.push(message)
  try {
    // What `.vitehub/nitro/database/migrate-on-start.mjs` runs before the server listens.
    await ensureDatabaseMigrations({ databases: { default: { db: { $client: client } } }, load: async () => shipped }, [
      "default",
    ])
  } finally {
    console.info = info
  }

  const expected = dropMigrations().map((migration) => migration.name)
  assert.equal(files.length, expected.length)
  assert.deepEqual(
    database
      .prepare("SELECT name FROM d1_migrations ORDER BY id")
      .all()
      .map((row) => row.name),
    expected,
  )
  assert.equal(log.length, expected.length)
  const created = tables(database)
  for (const table of [
    "session",
    "jwks",
    "oauth_client",
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_consent",
  ]) {
    assert.ok(created.includes(table), `${table} exists`)
  }
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
})
