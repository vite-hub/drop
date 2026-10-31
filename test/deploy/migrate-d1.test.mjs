import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { migrateD1 } from "../../scripts/migrate-d1.mjs"

const settings = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_D1_DATABASE_ID: "test-database",
}

test("migrations create Drop's schema once and share Wrangler's ledger", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  const database = new DatabaseSync(":memory:")
  const expectedMigrations = readdirSync(new URL("../../server/databases/migrations/", import.meta.url)).filter(
    (name) => name.endsWith(".sql"),
  ).length
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
      readdirSync(new URL("../../server/databases/migrations/", import.meta.url))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
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

test("Drizzle applies the migrations once, in journal order, on fresh and existing databases", async () => {
  const directory = new URL("../../server/databases/migrations/", import.meta.url)
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8"))
  const filenames = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
  assert.deepEqual(
    journal.entries.map((entry) => `${entry.tag}.sql`),
    filenames,
  )
  assert.deepEqual(
    journal.entries.map((entry) => entry.idx),
    journal.entries.map((_, index) => index),
  )
  for (let index = 1; index < journal.entries.length; index++)
    assert.ok(journal.entries[index].when > journal.entries[index - 1].when)
  const config = { migrationsFolder: fileURLToPath(directory) }
  const migrations = readMigrationFiles(config)
  // Existing databases can retain the ledger timestamps of migrations consolidated into 0000 on main.
  for (const appliedTimestamps of [
    [],
    [migrations[0].folderMillis],
    [migrations[0].folderMillis, 1792593042706, 1793089140860],
  ]) {
    const database = new DatabaseSync(":memory:")
    try {
      // Model a database already migrated on main: Drizzle only runs entries newer than its latest timestamp.
      database.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      if (appliedTimestamps.length) database.exec(migrations[0].sql.join(";\n"))
      for (const timestamp of appliedTimestamps) {
        database
          .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run(`applied-${timestamp}`, timestamp)
      }
      // Drizzle runs every migration newer than the ledger's latest timestamp, each adding a row.
      const latest = Math.max(0, ...appliedTimestamps)
      const expectedMigrations =
        appliedTimestamps.length + migrations.filter((migration) => migration.folderMillis > latest).length
      const db = drizzle(async (query, params, method) => {
        const statement = database.prepare(query)
        if (method === "run") {
          statement.run(...params)
          return { rows: [] }
        }
        statement.setReturnArrays(true)
        return { rows: statement.all(...params) }
      })
      const apply = async (statements) => database.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`)
      await migrate(db, apply, config)
      assert.ok(
        database
          .prepare("PRAGMA table_info(user)")
          .all()
          .some((column) => column.name === "plan"),
      )
      assert.equal(database.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get().n, expectedMigrations)
      assert.ok(
        database
          .prepare("PRAGMA table_info(comments)")
          .all()
          .some((column) => column.name === "suggestion"),
      )
      for (const table of [
        "drop_versions",
        "code_images",
        "quota_reservations",
        "abuse_reports",
        "vitehub_auth_events",
      ])
        assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table))
      assert.deepEqual(
        database
          .prepare("PRAGMA index_list(vitehub_auth_events)")
          .all()
          .map((row) => row.name)
          .filter((name) => !name.startsWith("sqlite_"))
          .sort(),
        [
          "vitehub_auth_events_actor",
          "vitehub_auth_events_time",
          "vitehub_auth_events_type",
          "vitehub_auth_events_user",
        ],
      )
      assert.ok(
        database
          .prepare("PRAGMA table_info(drops)")
          .all()
          .some((column) => column.name === "quarantined_at"),
      )
      assert.ok(
        database
          .prepare("PRAGMA table_info(drops)")
          .all()
          .some((column) => column.name === "agent"),
      )
      await migrate(db, apply, config)
      assert.equal(database.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get().n, expectedMigrations)
    } finally {
      database.close()
    }
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
