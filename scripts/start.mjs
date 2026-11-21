import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { adoptSqliteLedger } from "./adopt-sqlite-ledger.mjs"
import { migrations } from "./migrations.mjs"

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

/** Use folder names for Drizzle 1.0 ledgers, retaining the timestamp fallback for legacy ledgers. */
function pendingMigrations(database, entries, columns) {
  if (!columns.length) return entries
  if (columns.some(({ name }) => name === "name")) {
    const applied = new Set(
      database
        .prepare('SELECT name FROM "__drizzle_migrations"')
        .all()
        .map(({ name }) => name),
    )
    return entries.filter(({ tag }) => !applied.has(tag))
  }
  const { last } = database.prepare('SELECT max(created_at) AS last FROM "__drizzle_migrations"').get()
  return last === null ? entries : entries.filter((entry) => entry.when > Number(last))
}

/**
 * Copies the database into a `backups` folder beside it before migrations change it, and keeps the newest three
 * copies. A new database has nothing to keep.
 *
 * ViteHub's `migrateOnStart: { backup: true }` makes the same copy, but inside the server, after `adoptSqliteLedger`
 * below has rewritten the ledger, and only when migrations are pending. Its copy of a legacy database would hold the
 * adopted hash, and a database that needs only the adoption would get no copy, so Drop keeps its own.
 */
export function backupBeforeMigrate({ file, entries, backups, now = new Date(), log = console.log }) {
  if (!existsSync(file)) return
  const database = new DatabaseSync(file)
  try {
    const columns = database.prepare("PRAGMA table_info('__drizzle_migrations')").all()
    const pending = pendingMigrations(database, entries, columns)
    const adoption =
      columns.length &&
      !columns.some((column) => column.name === "name") &&
      database
        .prepare("SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ?")
        .get("3e6aa3ac60516bdd27edd10c4de906ced19bdbb289c2a2c247a8e7d35a5be083", 1793445000000)
    if (!pending.length && !adoption) return
    mkdirSync(backups, { recursive: true })
    const stamp = now
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "Z")
    const target = join(backups, `drop-${stamp}-before-${pending.at(-1)?.tag ?? "ledger-adoption"}.db`)
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
    // Workaround: ViteHub's migrateOnStart refuses D1 over HTTP, so a VPS on D1 keeps Drop's own migrator until
    // ViteHub can apply D1 migrations at start. It reads only the folders d1-migrations.json lists.
    const { migrateD1 } = await import("./migrate-d1.mjs")
    await migrateD1()
  } else {
    const file = databasePath(process.env.DROP_DATABASE_URL || undefined)
    backupBeforeMigrate({ file, entries: migrations(), backups: join(dirname(file), "backups") })
    if (existsSync(file)) {
      const database = new DatabaseSync(file)
      try {
        adoptSqliteLedger(database)
      } finally {
        database.close()
      }
    }
  }
  await import(pathToFileURL(join(app, ".output/server/index.mjs")).href)
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await start()
