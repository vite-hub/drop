import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

// The container's entry: backs up the SQLite database when this image brings migrations, then starts Drop, which
// applies them before it listens. D1 builds migrate over Cloudflare's API instead.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const KEEP_BACKUPS = 3

/** Path of a libSQL `file:` URL, relative to the working directory like libSQL reads it. */
export function databasePath(url = "file:.data/database/drop.db") {
  if (!url.startsWith("file:")) throw new Error("DROP_DATABASE_URL must be a local file: URL.")
  return url.startsWith("file://") ? fileURLToPath(url) : resolve(url.slice("file:".length).split("?")[0])
}

/** Migrations in the journal newer than the newest one the database recorded, the rule ViteHub applies them by. */
export function pendingMigrations(database, journal) {
  const ledger = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!ledger) return journal.entries
  const { last } = database.prepare('SELECT max(created_at) AS last FROM "__drizzle_migrations"').get()
  return last === null ? journal.entries : journal.entries.filter((entry) => entry.when > Number(last))
}

/**
 * Copies the database into a `backups` folder beside it before migrations change it, and keeps the newest three
 * copies. A new database has nothing to keep.
 */
export function backupBeforeMigrate({ file, journal, backups, now = new Date(), log = console.log }) {
  if (!existsSync(file)) return
  const database = new DatabaseSync(file)
  try {
    const pending = pendingMigrations(database, journal)
    if (!pending.length) return
    mkdirSync(backups, { recursive: true })
    const stamp = now
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "Z")
    const target = join(backups, `drop-${stamp}-before-${pending.at(-1).tag}.db`)
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
    log(`Drop: backed up the database to ${target} before ${pending.length} migration(s).`)
  } finally {
    database.close()
  }
  const copies = readdirSync(backups)
    .filter((name) => name.startsWith("drop-") && name.endsWith(".db"))
    .sort()
  for (const name of copies.slice(0, -KEEP_BACKUPS)) rmSync(join(backups, name))
}

async function start() {
  if (readFileSync(join(app, ".output/drop-database"), "utf8").trim() === "d1") {
    const { migrateD1 } = await import("./migrate-d1.mjs")
    await migrateD1()
  } else {
    const file = databasePath(process.env.DROP_DATABASE_URL || undefined)
    const journal = JSON.parse(readFileSync(join(app, "server/databases/migrations/meta/_journal.json"), "utf8"))
    backupBeforeMigrate({ file, journal, backups: join(dirname(file), "backups") })
  }
  await import(pathToFileURL(join(app, ".output/server/index.mjs")).href)
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await start()
