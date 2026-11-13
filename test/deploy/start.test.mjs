import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { backupBeforeMigrate, databasePath } from "../../scripts/start.mjs"

const journal = JSON.parse(
  readFileSync(new URL("../../server/databases/migrations/meta/_journal.json", import.meta.url), "utf8"),
)

function database(appliedThrough) {
  const dir = mkdtempSync(join(tmpdir(), "drop-start-"))
  const file = join(dir, "drop.db")
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE drops (id TEXT)")
  db.exec("INSERT INTO drops VALUES ('kept')")
  if (appliedThrough !== undefined) {
    db.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)')
    for (const entry of journal.entries.slice(0, appliedThrough + 1))
      db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run(entry.tag, entry.when)
  }
  db.close()
  return { file, backups: join(dir, "backups") }
}

test("an upgrade with new migrations copies the database first", () => {
  const { file, backups } = database(journal.entries.length - 3)
  const logs = []
  backupBeforeMigrate({ file, journal, backups, now: new Date("2026-11-13T08:00:00.123Z"), log: (m) => logs.push(m) })
  const [copy] = readdirSync(backups)
  assert.equal(copy, `drop-2026-11-13T08-00-00Z-before-${journal.entries.at(-1).tag}.db`)
  assert.match(logs[0], /before 2 migration\(s\)/)
  const restored = new DatabaseSync(join(backups, copy))
  assert.deepEqual({ ...restored.prepare("SELECT id FROM drops").get() }, { id: "kept" })
  restored.close()
})

test("an up-to-date database and a new one get no copy", () => {
  const current = database(journal.entries.length - 1)
  backupBeforeMigrate({ ...current, journal, log: () => {} })
  assert.equal(existsSync(current.backups), false)

  const fresh = database()
  backupBeforeMigrate({ file: join(fresh.backups, "..", "missing.db"), backups: fresh.backups, journal })
  assert.equal(existsSync(fresh.backups), false)
})

test("a database without the ledger counts every migration as pending", () => {
  const { file, backups } = database()
  backupBeforeMigrate({ file, journal, backups, log: () => {} })
  assert.equal(readdirSync(backups).length, 1)
})

test("only the newest three copies stay", () => {
  const { file, backups } = database(0)
  for (const day of [10, 11, 12, 13])
    backupBeforeMigrate({ file, journal, backups, now: new Date(`2026-11-${day}T00:00:00Z`), log: () => {} })
  assert.deepEqual(
    readdirSync(backups).map((name) => name.slice(5, 15)),
    ["2026-11-11", "2026-11-12", "2026-11-13"],
  )
  writeFileSync(join(backups, "notes.txt"), "kept")
  backupBeforeMigrate({ file, journal, backups, now: new Date("2026-11-14T00:00:00Z"), log: () => {} })
  assert.equal(readdirSync(backups).includes("notes.txt"), true)
})

test("database paths read like libSQL's file: URLs", () => {
  assert.equal(databasePath(), resolve(".data/database/drop.db"))
  assert.equal(databasePath("file:///var/drop/drop.db"), "/var/drop/drop.db")
  assert.equal(databasePath("file:data/drop.db?mode=rwc"), resolve("data/drop.db"))
  assert.throws(() => databasePath("libsql://example.turso.io"), /file: URL/)
})
