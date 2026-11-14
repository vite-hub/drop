import { adoptSqliteLedger } from "../../scripts/adopt-sqlite-ledger.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { migrateD1 } from "../../scripts/migrate-d1.mjs"
import { migrations as dropMigrations } from "../../scripts/migrations.mjs"

const settings = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_D1_DATABASE_ID: "test-database",
}

test("migrations create Drop's schema once and share Wrangler's ledger", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  const database = new DatabaseSync(":memory:")
  const expectedMigrations = dropMigrations().length
  let migrations = 0
  try {
    Object.assign(process.env, settings)
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/test-database/query")
      assert.equal(options.headers.Authorization, "Bearer test-token")
      const { sql } = JSON.parse(options.body)
      if (sql.startsWith("SELECT"))
        return Response.json({ success: true, result: [{ success: true, results: database.prepare(sql).all() }] })
      if (sql.includes("INSERT INTO d1_migrations")) migrations++
      database.exec(`BEGIN; ${sql}; COMMIT;`)
      return Response.json({ success: true, result: [{ success: true, results: [] }] })
    }
    await migrateD1()
    assert.equal(migrations, expectedMigrations)
    assert.equal(database.prepare("SELECT count(*) AS count FROM d1_migrations").get().count, expectedMigrations)
    assert.deepEqual(
      database
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all()
        .map((row) => row.name),
      dropMigrations().map((migration) => migration.name),
    )
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())
    await migrateD1()
    assert.equal(migrations, expectedMigrations)
  } finally {
    globalThis.fetch = previousFetch
    process.env = previousEnv
    database.close()
  }
})

test("a database Drizzle Kit 0.x migrated to any point upgrades its ledger and runs only the rest", async () => {
  const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
  // In folder order, as Drizzle applies them. Rows 0.x wrote carry the hash of the SQL file and its journal time, in
  // milliseconds within the folder's second, and no name.
  const folders = dropMigrations().sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const hash = (sql) => createHash("sha256").update(sql).digest("hex")
  const journal = JSON.parse(readFileSync(new URL("./fixtures/legacy-journal.json", import.meta.url), "utf8")).entries
  for (let applied = 0; applied <= folders.length; applied++) {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      database.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      folders.slice(0, applied).forEach((migration) => {
        database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""))
        database
          .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run(hash(migration.sql), journal.find((entry) => migration.tag.endsWith(`_${entry.tag}`)).when)
      })
      // This shipped variant survives timestamp-based upgrades even though its SQL was later replaced with SELECT 1.
      if (applied === folders.length) {
        const historical = readFileSync(new URL("./fixtures/0004_comment_suggestions.sql", import.meta.url), "utf8")
        assert.equal(hash(historical), "3e6aa3ac60516bdd27edd10c4de906ced19bdbb289c2a2c247a8e7d35a5be083")
        database
          .prepare("UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?")
          .run(hash(historical), 1793445000000)
        adoptSqliteLedger(database)
        adoptSqliteLedger(database)
      }
      const run = (query, params, rowMode) => {
        const statement = database.prepare(query)
        if (!statement.columns().length) return statement.run(...params)
        statement.setReturnArrays(rowMode !== "object")
        return statement.all(...params)
      }
      const db = drizzle({
        get: async (query, params, rowMode) => run(query, params, rowMode)[0],
        all: async (query, params, rowMode) => run(query, params, rowMode),
        run: async (query, params) => run(query, params),
      })
      await migrate(db, async (statements) => database.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`), {
        migrationsFolder: fileURLToPath(directory),
      })
      const ledger = database.prepare("SELECT name FROM __drizzle_migrations ORDER BY id").all()
      assert.deepEqual(
        ledger.map((row) => row.name),
        folders.map((migration) => migration.tag),
        `after ${applied} applied`,
      )
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'vitehub_comment_threads'").get())
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      assert.deepEqual(database.prepare("SELECT id FROM drops LIMIT 1").all(), [])
    } finally {
      database.close()
    }
  }
})

test("the latest Drizzle snapshot includes all migrated columns of its registered tables", () => {
  const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
  const latest = dropMigrations()
    .map((migration) => migration.tag)
    .sort()
    .at(-1)
  const snapshot = JSON.parse(readFileSync(new URL(`${latest}/snapshot.json`, directory), "utf8"))
  const database = new DatabaseSync(":memory:")
  try {
    for (const migration of dropMigrations()) database.exec(migration.sql)
    const tables = snapshot.ddl.filter((entity) => entity.entityType === "tables")
    for (const table of tables) {
      const columns = database.prepare("SELECT name FROM pragma_table_info(?) ORDER BY name").all(table.name)
      assert.deepEqual(
        columns.map((column) => column.name),
        snapshot.ddl
          .filter((entity) => entity.entityType === "columns" && entity.table === table.name)
          .map((column) => column.name)
          .sort(),
        table.name,
      )
    }
  } finally {
    database.close()
  }
})

test("missing credentials and D1 errors stop migrations", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  try {
    Object.assign(process.env, settings)
    delete process.env.CLOUDFLARE_D1_DATABASE_ID
    await assert.rejects(migrateD1(), /CLOUDFLARE_D1_DATABASE_ID is required/)
    Object.assign(process.env, settings)
    globalThis.fetch = async () =>
      Response.json({ success: false, errors: [{ message: "Database unavailable" }] }, { status: 503 })
    await assert.rejects(migrateD1(), /D1 migration failed \(503\): Database unavailable/)
  } finally {
    globalThis.fetch = previousFetch
    process.env = previousEnv
  }
})
