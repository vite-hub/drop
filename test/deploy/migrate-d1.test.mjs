import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { d1Codecs } from "drizzle-orm/d1/codecs"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { createCommentsStore } from "vite-hub/comments/server"
import { d1Migrations, migrateD1 } from "../../scripts/migrate-d1.mjs"

const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
const settings = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_D1_DATABASE_ID: "test-database",
}

/**
 * Drop's migrations as Drizzle Kit 0.x wrote them, in the order it applied them: the flat file each one was, which is the
 * name in D1's `d1_migrations`, and the millisecond in its journal, which is `created_at` in a SQLite `__drizzle_migrations`.
 * `vitehub database up` kept only the second in the folder names, so four migrations share one.
 */
const DRIZZLE_KIT_0 = [
  ["0000_init.sql", 1793094947397],
  ["0003_auth_events.sql", 1793095000000],
  ["0004_comment_suggestions.sql", 1793445000000],
  ["0003_vitehub_comments.sql", 1793445000001],
  ["0004_drop_comments_on_vitehub.sql", 1793445000002],
  ["0005_comment_cleanup.sql", 1793445000003],
  ["0006_suggestion_acceptances.sql", 1793450753903],
  ["0007_suggestion_undos.sql", 1793455248455],
  ["0005_vitehub_comments_release.sql", 1793529936150],
  ["0009_drop_comments_release_upgrade.sql", 1793529936151],
  ["0010_review_submissions.sql", 1793716344918],
  ["0011_comments_one_model.sql", 1793716344919],
  ["0012_member_user_cascade.sql", 1793907016903],
  ["0013_team_member_limit.sql", 1793907352663],
  ["0014_better_auth_rate_limit.sql", 1793954839294],
  ["0015_comments_request_id.sql", 1794441794439],
]

test("the converted folders keep the file names D1 recorded", async () => {
  const names = (await d1Migrations()).map((migration) => migration.name)
  assert.deepEqual(names, DRIZZLE_KIT_0.map(([name]) => name).sort())
})

test("migrations create Drop's schema once and share Wrangler's ledger", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  const database = new DatabaseSync(":memory:")
  const expected = (await d1Migrations()).map((migration) => migration.name)
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
    assert.equal(migrations, expected.length)
    assert.deepEqual(
      database
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all()
        .map((row) => row.name),
      expected,
    )
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())
    await migrateD1()
    assert.equal(migrations, expected.length)

    // A D1 that Drop migrated before the folders, one migration behind, gets that one migration and nothing else.
    database.exec("DELETE FROM d1_migrations WHERE name = '0015_comments_request_id.sql'")
    database.exec("DROP INDEX vitehub_comment_threads_scope_request")
    database.exec("ALTER TABLE vitehub_comment_threads DROP COLUMN request_id")
    await migrateD1()
    assert.equal(migrations, expected.length + 1)
    assert.ok(
      database
        .prepare("PRAGMA table_info(vitehub_comment_threads)")
        .all()
        .some((column) => column.name === "request_id"),
    )
  } finally {
    globalThis.fetch = previousFetch
    process.env = previousEnv
    database.close()
  }
})

test("Drizzle 1.0 takes over a SQLite database Drizzle Kit 0.x migrated, at every step, replaying and skipping nothing", async () => {
  const config = { migrationsFolder: fileURLToPath(directory) }
  const names = JSON.parse(readFileSync(new URL("d1-migrations.json", directory), "utf8"))
  const folders = Object.fromEntries(Object.entries(names).map(([folder, file]) => [file, folder]))
  const migrations = readMigrationFiles(config)
  const byFile = Object.fromEntries(
    DRIZZLE_KIT_0.map(([file]) => [file, migrations.find((m) => m.name === folders[file])]),
  )
  // In the order Drizzle Kit 0.x applied them.
  const history = DRIZZLE_KIT_0.map(([file, when]) => ({ ...byFile[file], file, when }))
  const at = (file) => history.find((migration) => migration.file === file)
  const baseline = at("0000_init.sql")
  const comments = at("0003_vitehub_comments.sql")
  const cleanup = at("0005_comment_cleanup.sql")
  const acceptances = at("0006_suggestion_acceptances.sql")
  const undos = at("0007_suggestion_undos.sql")
  const release = at("0005_vitehub_comments_release.sql")
  const oneModel = at("0011_comments_one_model.sql")
  // A fresh database without a ledger, then databases Drizzle Kit 0.x left after each migration.
  for (const applied of [undefined, ...history.map((_, index) => history.slice(0, index + 1))]) {
    const appliedMigrations = applied ?? []
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      if (applied) {
        // Drizzle Kit 0.x's ledger: SQLite gives a SERIAL key no ids.
        database.exec(
          "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
        )
        for (const migration of appliedMigrations) {
          const sql = readFileSync(new URL(`${migration.name}/migration.sql`, directory), "utf8")
          database
            .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
            .run(createHash("sha256").update(sql).digest("hex"), migration.when)
        }
      }
      for (const migration of appliedMigrations) {
        database.exec(migration.sql.join(";\n"))
        if (migration !== baseline) continue
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
      if (appliedMigrations.includes(oneModel))
        database.exec(`
          INSERT INTO vitehub_comment_threads
            (id, scope, n, subject_kind, subject_id, anchor, status, author_id, author_name, created_at, updated_at)
          VALUES ('upgrade-thread', 'upgrade', 1, 'page', '/', '{"kind":"page"}', 'open', 'admin', 'Admin', 1, 1);
        `)
      // Live-site rows, while the database still has the live-site tables.
      const seeded = appliedMigrations.includes(comments) && !appliedMigrations.includes(oneModel)
      if (seeded) {
        database.exec(`
          INSERT INTO vitehub_comment_threads (id, number, page, anchor, status, created_by, created_at, updated_at)
            VALUES ('existing-thread', 12, '/', '{}', 'open', '{"id":"admin","name":"Admin"}', 1, 1);
          INSERT INTO vitehub_comments (id, thread_id, body, mentions, author, created_at)
            VALUES ('existing-comment', 'existing-thread', 'Keep this comment', '[]', '{"id":"admin","name":"Admin"}', 1);
        `)
        if (appliedMigrations.includes(release))
          database.exec("INSERT INTO vitehub_comment_scope_counters (scope, last_number) VALUES ('pages', 12)")
      }
      if (appliedMigrations.includes(cleanup))
        database.exec("INSERT INTO comment_cleanup VALUES ('deleted-drop', 'drop:deleted-drop', 0, 1)")
      if (appliedMigrations.includes(acceptances))
        database.exec(
          "INSERT INTO suggestion_acceptances (thread_id, drop_id, version) VALUES ('accepted-thread', 'legacy-image', 2)",
        )
      if (appliedMigrations.includes(undos)) database.exec("UPDATE suggestion_acceptances SET undone_version = 3")

      const ran = []
      const runQuery = (method) => async (query, params, rowMode) => {
        const statement = database.prepare(query)
        if (method === "run") return statement.run(...params)
        statement.setReturnArrays(rowMode !== "object")
        const rows = statement.all(...params)
        return method === "get" ? rows[0] : rows
      }
      const db = drizzle(
        {
          get: runQuery("get"),
          all: runQuery("all"),
          run: runQuery("run"),
          batch: (batch) =>
            Promise.all(batch.map((item) => runQuery(item.method)(item.sql, item.params, item.rowMode))),
        },
        { codecs: d1Codecs },
      )
      const apply = async (statements) => {
        for (const statement of statements) {
          const name = statement.match(/insert into "__drizzle_migrations" .* values\('[^']*', [^,]+, '([^']+)'/i)?.[1]
          if (name) ran.push(name)
        }
        database.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`)
      }
      await migrate(db, apply, config)
      // Every migration Drizzle Kit 0.x had applied keeps its row, now named; only the others ran.
      const pending = migrations.filter((migration) => !appliedMigrations.some((done) => done.name === migration.name))
      assert.deepEqual(
        ran,
        pending.map((migration) => migration.name),
      )
      assert.deepEqual(
        database
          .prepare("SELECT name FROM __drizzle_migrations")
          .all()
          .map((row) => row.name)
          .sort(),
        migrations.map((migration) => migration.name).sort(),
      )
      for (const table of [
        "drop_versions",
        "code_images",
        "quota_reservations",
        "abuse_reports",
        "vitehub_comment_threads",
        "vitehub_comment_messages",
        "vitehub_comment_counters",
        "vitehub_comment_threads_live",
        "vitehub_comments",
        "vitehub_comment_scope_counters",
        "vitehub_comment_forge",
        "vitehub_auth_events",
        "comment_cleanup",
        "suggestion_acceptances",
        "rate_limit",
      ])
        assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table)
      if (appliedMigrations.includes(acceptances))
        assert.deepEqual(
          { ...database.prepare("SELECT version, undone_version FROM suggestion_acceptances").get() },
          { version: 2, undone_version: appliedMigrations.includes(undos) ? 3 : null },
        )
      const threadColumns = database.prepare("PRAGMA table_info(vitehub_comment_threads)").all()
      for (const name of ["scope", "n", "subject_kind", "metadata", "revision", "request_id"])
        assert.ok(threadColumns.some((column) => column.name === name))
      if (appliedMigrations.includes(oneModel)) {
        const store = createCommentsStore(db)
        assert.equal((await store.getById("upgrade-thread")).author.name, "Admin")
      }
      for (const table of ["comments", "comment_replies"])
        assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), undefined)
      assert.equal(
        database.prepare("SELECT count(*) AS n FROM comment_attachments").get().n,
        appliedMigrations.includes(baseline) ? 1 : 0,
      )
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      assert.equal(
        database.prepare("SELECT count(*) AS n FROM comment_cleanup").get().n,
        appliedMigrations.includes(cleanup) ? 1 : 0,
      )
      if (seeded) {
        assert.equal(
          database.prepare("SELECT body FROM vitehub_comment_messages WHERE id = 'existing-comment'").get().body,
          "Keep this comment",
        )
        // The live-site rows stay behind as the backup.
        assert.equal(
          database.prepare("SELECT page FROM vitehub_comment_threads_live WHERE id = 'existing-thread'").get().page,
          "/",
        )
      }
      ran.length = 0
      await migrate(db, apply, config)
      assert.deepEqual(ran, [])
    } finally {
      database.close()
    }
  }
})

test("the latest Drizzle snapshot includes all migrated columns of its registered tables", async () => {
  const latest = (await d1Migrations()).at(-1).file
  const snapshot = JSON.parse(readFileSync(new URL("snapshot.json", latest), "utf8"))
  const database = new DatabaseSync(":memory:")
  try {
    for (const { file } of await d1Migrations()) database.exec(readFileSync(file, "utf8"))
    const tables = Map.groupBy(
      snapshot.ddl.filter((entity) => entity.entityType === "columns"),
      (column) => column.table,
    )
    for (const [table, columns] of tables) {
      const actual = database.prepare("SELECT name FROM pragma_table_info(?) ORDER BY name").all(table)
      assert.deepEqual(
        actual.map((column) => column.name),
        columns.map((column) => column.name).sort(),
        table,
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
