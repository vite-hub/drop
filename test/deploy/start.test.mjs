import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { backupBeforeMigrate, databasePath, readMigrations } from "../../scripts/start.mjs"

const migrations = readMigrations(new URL("../../server/databases/default/migrations/", import.meta.url))

/** A database with the first migrations applied, in the ledger Drizzle Kit 0.x wrote or, with `named`, Drizzle 1.0's. */
function database(appliedThrough, { named = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "drop-start-"))
  const file = join(dir, "drop.db")
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE drops (id TEXT)")
  db.exec("INSERT INTO drops VALUES ('kept')")
  if (appliedThrough !== undefined) {
    db.exec(
      `CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric${named ? ", name text" : ""})`,
    )
    // Drizzle Kit 0.x recorded the millisecond each migration was made; its folder name keeps only the second.
    const insert = named
      ? db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES (?, ?, ?)')
      : db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
    for (const migration of migrations.slice(0, appliedThrough + 1))
      insert.run(migration.tag, migration.when + 397, ...(named ? [migration.tag] : []))
  }
  db.close()
  return { file, backups: join(dir, "backups") }
}

test("an upgrade with new migrations copies the database first", () => {
  const { file, backups } = database(migrations.length - 3)
  const logs = []
  backupBeforeMigrate({
    file,
    migrations,
    backups,
    now: new Date("2026-11-13T08:00:00.123Z"),
    log: (m) => logs.push(m),
  })
  const [copy] = readdirSync(backups)
  assert.equal(copy, `drop-2026-11-13T08-00-00Z-before-${migrations.at(-1).tag}.db`)
  assert.match(logs[0], /before 2 migration\(s\)/)
  const restored = new DatabaseSync(join(backups, copy))
  assert.deepEqual({ ...restored.prepare("SELECT id FROM drops").get() }, { id: "kept" })
  restored.close()
})

test("an up-to-date database and a new one get no copy", () => {
  const current = database(migrations.length - 1)
  backupBeforeMigrate({ ...current, migrations, log: () => {} })
  assert.equal(existsSync(current.backups), false)

  const fresh = database()
  backupBeforeMigrate({ file: join(fresh.backups, "..", "missing.db"), backups: fresh.backups, migrations })
  assert.equal(existsSync(fresh.backups), false)
})

test("a Drizzle 1.0 ledger counts the folders it doesn't name", () => {
  const behind = database(migrations.length - 2, { named: true })
  const logs = []
  backupBeforeMigrate({ ...behind, migrations, log: (m) => logs.push(m) })
  assert.match(logs[0], /before 1 migration\(s\)/)
  const current = database(migrations.length - 1, { named: true })
  backupBeforeMigrate({ ...current, migrations, log: () => {} })
  assert.equal(existsSync(current.backups), false)
})

test("a database without the ledger counts every migration as pending", () => {
  const { file, backups } = database()
  backupBeforeMigrate({ file, migrations, backups, log: () => {} })
  assert.equal(readdirSync(backups).length, 1)
})

test("only the newest three copies stay", () => {
  const { file, backups } = database(0)
  for (const day of [10, 11, 12, 13])
    backupBeforeMigrate({ file, migrations, backups, now: new Date(`2026-11-${day}T00:00:00Z`), log: () => {} })
  assert.deepEqual(
    readdirSync(backups).map((name) => name.slice(5, 15)),
    ["2026-11-11", "2026-11-12", "2026-11-13"],
  )
  writeFileSync(join(backups, "notes.txt"), "kept")
  backupBeforeMigrate({ file, migrations, backups, now: new Date("2026-11-14T00:00:00Z"), log: () => {} })
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
