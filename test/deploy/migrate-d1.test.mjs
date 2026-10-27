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

test("Drizzle applies the migrations once, in journal order", async () => {
  const directory = new URL("../../server/databases/migrations/", import.meta.url)
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8"))
  const filenames = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
  assert.deepEqual(
    journal.entries.map((entry) => `${entry.tag}.sql`),
    filenames,
  )
  // Main squashed 0001 and 0002 into 0000. Keep Comments' filename so Wrangler's ledger skips it.
  for (const entry of journal.entries) assert.equal(entry.idx, Number.parseInt(entry.tag, 10))
  for (let index = 1; index < journal.entries.length; index++) {
    assert.ok(journal.entries[index].idx > journal.entries[index - 1].idx)
    assert.ok(journal.entries[index].when > journal.entries[index - 1].when)
  }
  const config = { migrationsFolder: fileURLToPath(directory) }
  const migrations = readMigrationFiles(config)
  // Comments follows main's new baseline timestamp. Upgraded databases may have its tables at the old timestamp.
  for (const { alreadyApplied, oldComments = false } of [
    { alreadyApplied: 0 },
    { alreadyApplied: 1 },
    { alreadyApplied: 2 },
    { alreadyApplied: 2, oldComments: true },
  ]) {
    const database = new DatabaseSync(":memory:")
    try {
      if (alreadyApplied) {
        database.exec(
          "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
        )
        for (const migration of migrations.slice(0, alreadyApplied)) {
          database.exec(migration.sql.join(";\n"))
          database
            .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
            .run(migration.hash, oldComments && migration === migrations[1] ? 1793091156010 : migration.folderMillis)
        }
      }
      if (alreadyApplied === 2) {
        database.exec(`
          INSERT INTO vitehub_comment_threads (id, page, anchor, status, created_by, created_at, updated_at)
            VALUES ('existing-thread', '/', '{}', 'open', 'admin', 1, 1);
          INSERT INTO vitehub_comments (id, thread_id, body, mentions, author, created_at)
            VALUES ('existing-comment', 'existing-thread', 'Keep this comment', '[]', 'admin', 1);
        `)
      }
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
      const expectedMigrations = migrations.length + Number(oldComments)
      assert.equal(database.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get().n, expectedMigrations)
      for (const table of [
        "drop_versions",
        "code_images",
        "quota_reservations",
        "abuse_reports",
        "vitehub_comment_threads",
        "vitehub_comments",
      ])
        assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table))
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
      const threadColumns = database.prepare("PRAGMA table_info(vitehub_comment_threads)").all()
      for (const name of ["scope", "number", "metadata"])
        assert.ok(threadColumns.some((column) => column.name === name))
      if (alreadyApplied === 2) {
        assert.equal(
          database.prepare("SELECT body FROM vitehub_comments WHERE id = 'existing-comment'").get().body,
          "Keep this comment",
        )
        assert.equal(
          database.prepare("SELECT page FROM vitehub_comment_threads WHERE id = 'existing-thread'").get().page,
          "/",
        )
      }
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
