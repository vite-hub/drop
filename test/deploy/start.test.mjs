import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { test } from "vite-plus/test"
import { migrations } from "../../scripts/migrations.mjs"
import { backupBeforeMigrate, databasePath } from "../../scripts/start.mjs"

const entries = migrations()

function database(appliedThrough) {
  const dir = mkdtempSync(join(tmpdir(), "drop-start-"))
  const file = join(dir, "drop.db")
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE drops (id TEXT)")
  db.exec("INSERT INTO drops VALUES ('kept')")
  if (appliedThrough !== undefined) {
    db.exec(
      'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)',
    )
    for (const entry of entries.slice(0, appliedThrough + 1))
      db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES (?, ?, ?)').run(
        entry.tag,
        entry.when,
        entry.tag,
      )
  }
  db.close()
  return { file, backups: join(dir, "backups") }
}

test("an upgrade with new migrations copies the database first", () => {
  const { file, backups } = database(entries.length - 3)
  const logs = []
  backupBeforeMigrate({ file, entries, backups, now: new Date("2026-11-13T08:00:00.123Z"), log: (m) => logs.push(m) })
  const [copy] = readdirSync(backups)
  assert.equal(copy, `drop-2026-11-13T08-00-00Z-before-${entries.at(-1).tag}.db`)
  assert.match(logs[0], /before 2 migration\(s\)/)
  const restored = new DatabaseSync(join(backups, copy))
  assert.deepEqual({ ...restored.prepare("SELECT id FROM drops").get() }, { id: "kept" })
  restored.close()
})

test("an older missing migration is backed up before upgrading a database with pins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drop-start-"))
  const file = join(dir, "drop.db")
  const backups = join(dir, "backups")
  const db = new DatabaseSync(file)
  const handoffs = entries.find(({ name }) => name === "0017_comment_sends.sql")
  assert.ok(handoffs)
  const pins = "SELECT user_id, drop_id, at FROM drop_pins"
  const sends = "SELECT count(*) AS n FROM vitehub_comment_sends"
  const recorded = 'SELECT name FROM "__drizzle_migrations" WHERE name = ?'
  try {
    db.exec(
      'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)',
    )
    for (const entry of entries) {
      if (entry === handoffs) continue
      db.exec(entry.sql)
      db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES (?, ?, ?)').run(
        createHash("sha256").update(entry.sql).digest("hex"),
        entry.when,
        entry.tag,
      )
    }
    db.exec(`INSERT INTO user (id, name, email) VALUES ('reader', 'Reader', 'reader@example.com');
      INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at)
      VALUES ('doc', 'reader', 'markdown', 'Existing doc', 'doc.md', 'browser', 'Reader', 1, 1);
      INSERT INTO drop_pins (user_id, drop_id, at) VALUES ('reader', 'doc', 42);`)

    backupBeforeMigrate({ file, entries, backups, log: () => {} })
    const [copy] = readdirSync(backups)
    assert.ok(copy.endsWith(`-before-${handoffs.tag}.db`))
    const restored = new DatabaseSync(join(backups, copy), { readOnly: true })
    try {
      assert.equal(restored.prepare(recorded).get(handoffs.tag), undefined)
      assert.throws(() => restored.prepare(sends), /no such table/)
      assert.deepEqual({ ...restored.prepare(pins).get() }, { user_id: "reader", drop_id: "doc", at: 42 })
    } finally {
      restored.close()
    }

    const run = (query, params, rowMode) => {
      const statement = db.prepare(query)
      if (!statement.columns().length) return statement.run(...params)
      statement.setReturnArrays(rowMode !== "object")
      return statement.all(...params)
    }
    const migrator = drizzle({
      get: async (query, params, rowMode) => run(query, params, rowMode)[0],
      all: async (query, params, rowMode) => run(query, params, rowMode),
      run: async (query, params) => run(query, params),
    })
    await migrate(migrator, async (statements) => db.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`), {
      migrationsFolder: fileURLToPath(new URL("../../server/databases/default/migrations/", import.meta.url)),
    })
    assert.ok(db.prepare(recorded).get(handoffs.tag))
    assert.equal(db.prepare(sends).get().n, 0)
    assert.deepEqual({ ...db.prepare(pins).get() }, { user_id: "reader", drop_id: "doc", at: 42 })
    backupBeforeMigrate({ file, entries, backups, log: () => assert.fail("all migrations have been recorded") })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an up-to-date database and a new one get no copy", () => {
  const current = database(entries.length - 1)
  backupBeforeMigrate({ ...current, entries, log: () => {} })
  assert.equal(existsSync(current.backups), false)

  const fresh = database()
  backupBeforeMigrate({ file: join(fresh.backups, "..", "missing.db"), backups: fresh.backups, entries })
  assert.equal(existsSync(fresh.backups), false)
})

test("a database without the ledger counts every migration as pending", () => {
  const { file, backups } = database()
  backupBeforeMigrate({ file, entries, backups, log: () => {} })
  assert.equal(readdirSync(backups).length, 1)
})

test("only the newest three copies stay", () => {
  const { file, backups } = database(0)
  for (const day of [10, 11, 12, 13])
    backupBeforeMigrate({ file, entries, backups, now: new Date(`2026-11-${day}T00:00:00Z`), log: () => {} })
  assert.deepEqual(
    readdirSync(backups).map((name) => name.slice(5, 15)),
    ["2026-11-11", "2026-11-12", "2026-11-13"],
  )
  writeFileSync(join(backups, "notes.txt"), "kept")
  backupBeforeMigrate({ file, entries, backups, now: new Date("2026-11-14T00:00:00Z"), log: () => {} })
  assert.equal(readdirSync(backups).includes("notes.txt"), true)
})

test("database paths read like libSQL's file: URLs", () => {
  assert.equal(databasePath(), resolve(".data/database/drop.db"))
  assert.equal(databasePath("file:///var/drop/drop.db"), "/var/drop/drop.db")
  assert.equal(databasePath("file:data/drop.db?mode=rwc"), resolve("data/drop.db"))
  assert.equal(databasePath("file:.data/database/my%20drop.db"), resolve(".data/database/my drop.db"))
  assert.equal(databasePath("file:/app/.data/my%20drop.db"), "/app/.data/my drop.db")
  assert.throws(() => databasePath("libsql://example.turso.io"), /file: URL/)
})
