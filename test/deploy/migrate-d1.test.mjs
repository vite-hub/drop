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
  // Keep existing filenames for Wrangler's ledger; journal indexes can have gaps after main's squash.
  for (let index = 1; index < journal.entries.length; index++) {
    assert.ok(journal.entries[index].idx > journal.entries[index - 1].idx)
    assert.ok(journal.entries[index].when > journal.entries[index - 1].when)
  }
  const config = { migrationsFolder: fileURLToPath(directory) }
  const migrations = readMigrationFiles(config)
  const [baseline, authEvents, comments] = migrations
  // Comments must follow main's auth migration. Earlier previews can already contain comments at either old timestamp.
  for (const {
    appliedMigrations,
    appliedTimestamps = appliedMigrations.map((migration) => migration.folderMillis),
    expectedMigrations,
  } of [
    { appliedMigrations: [], expectedMigrations: migrations.length },
    { appliedMigrations: [baseline], expectedMigrations: migrations.length },
    {
      appliedMigrations: [baseline],
      appliedTimestamps: [baseline.folderMillis, 1792593042706, 1793089140860],
      expectedMigrations: migrations.length + 2,
    },
    { appliedMigrations: [baseline, authEvents], expectedMigrations: migrations.length },
    {
      appliedMigrations: [baseline, comments],
      appliedTimestamps: [baseline.folderMillis, 1793091156010],
      expectedMigrations: migrations.length + 1,
    },
    {
      appliedMigrations: [baseline, comments],
      appliedTimestamps: [baseline.folderMillis, 1793094947398],
      expectedMigrations: migrations.length + 1,
    },
    {
      appliedMigrations: [baseline, authEvents, comments],
      appliedTimestamps: [baseline.folderMillis, authEvents.folderMillis, 1793094947398],
      expectedMigrations: migrations.length + 1,
    },
    { appliedMigrations: [baseline, authEvents, comments], expectedMigrations: migrations.length },
  ]) {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      database.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      for (const migration of appliedMigrations) database.exec(migration.sql.join(";\n"))
      for (const timestamp of appliedTimestamps) {
        database
          .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run(`applied-${timestamp}`, timestamp)
      }
      if (appliedMigrations.includes(baseline)) {
        database.exec(`
          INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at)
          VALUES ('legacy-image', 'owner', 'image', 'Image', 'image.png', 'human', 'Owner', 1, 1);
          INSERT INTO comments (id, drop_id, n, kind, selector, body, author_name, created_at)
          VALUES ('legacy-comment', 'legacy-image', 1, 'page', '', 'Comment', 'Owner', 1);
          INSERT INTO comment_replies (id, comment_id, body, author_name, created_at)
          VALUES ('legacy-reply', 'legacy-comment', 'Reply', 'Owner', 1);
          INSERT INTO comment_attachments (drop_id, comment_id, reply_id, created_at)
          VALUES ('legacy-image', 'legacy-comment', 'legacy-reply', 1);
        `)
      }
      if (appliedMigrations.includes(comments)) {
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
      assert.equal(database.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get().n, expectedMigrations)
      for (const table of [
        "drop_versions",
        "code_images",
        "quota_reservations",
        "abuse_reports",
        "vitehub_comment_threads",
        "vitehub_comments",
        "vitehub_auth_events",
        "comment_cleanup",
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
      const threadColumns = database.prepare("PRAGMA table_info(vitehub_comment_threads)").all()
      for (const name of ["scope", "number", "metadata"])
        assert.ok(threadColumns.some((column) => column.name === name))
      for (const table of ["comments", "comment_replies"])
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), undefined)
      assert.equal(
        database.prepare("SELECT count(*) AS n FROM comment_attachments").get().n,
        appliedMigrations.includes(baseline) ? 1 : 0,
      )
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      if (appliedMigrations.includes(comments)) {
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
