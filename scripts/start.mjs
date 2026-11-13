import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

// The container's entry: backs up the SQLite database when this image brings migrations, then starts Drop, which
// applies them before it listens. D1 builds migrate over Cloudflare's API instead.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const KEEP_BACKUPS = 3

/** Path of a libSQL `file:` URL, percent-decoded and relative to the working directory, as libSQL opens it. */
export function databasePath(url = "file:.data/database/drop.db") {
  if (!url.startsWith("file:")) throw new Error("DROP_DATABASE_URL must be a local file: URL.")
  if (url.startsWith("file://")) return fileURLToPath(url)
  return resolve(decodeURIComponent(url.slice("file:".length).split("?")[0]))
}

/**
 * The migration folders, oldest first as Drizzle 1.0 applies them, each with the second of its folder name
 * (`<YYYYMMDDHHmmss>_<name>`).
 */
export function readMigrations(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(({ name: tag }) => {
      const [year, month, day, hour, minute, second] = tag.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/).slice(1)
      return { tag, when: Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) }
    })
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * Migrations the database hasn't recorded. Drizzle 1.0 records each folder's name; a ledger Drizzle Kit 0.x wrote has no
 * names, only the millisecond each migration was made, so a folder from a later second is new.
 */
export function pendingMigrations(database, migrations) {
  const ledger = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!ledger) return migrations
  const named = database
    .prepare("SELECT name FROM pragma_table_info('__drizzle_migrations')")
    .all()
    .some((column) => column.name === "name")
  if (named) {
    const applied = new Set(
      database
        .prepare('SELECT name FROM "__drizzle_migrations"')
        .all()
        .map((row) => row.name),
    )
    return migrations.filter((migration) => !applied.has(migration.tag))
  }
  const { last } = database.prepare('SELECT max(created_at) AS last FROM "__drizzle_migrations"').get()
  if (last === null) return migrations
  const second = Math.floor(Number(last) / 1000) * 1000
  return migrations.filter((migration) => migration.when > second)
}

/**
 * Copies the database into a `backups` folder beside it before migrations change it, and keeps the newest three
 * copies. A new database has nothing to keep.
 */
export function backupBeforeMigrate({ file, migrations, backups, now = new Date(), log = console.log }) {
  if (!existsSync(file)) return
  const database = new DatabaseSync(file)
  try {
    const pending = pendingMigrations(database, migrations)
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
    const migrations = readMigrations(join(app, "server/databases/default/migrations"))
    backupBeforeMigrate({ file, migrations, backups: join(dirname(file), "backups") })
  }
  await import(pathToFileURL(join(app, ".output/server/index.mjs")).href)
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await start()
