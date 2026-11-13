import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { migrations } from "./migrations.mjs"

/** Adopt a known shipped 0.x hash without replaying a migration or changing shipped SQL. */
export function adoptSqliteLedger(database) {
  if (!database.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()) return
  // Named ledgers have already been adopted by Drizzle 1.0.
  if (
    database
      .prepare("PRAGMA table_info('__drizzle_migrations')")
      .all()
      .some((column) => column.name === "name")
  )
    return
  const migration = migrations().find((entry) => entry.name === "0004_comment_suggestions.sql")
  if (!migration) throw new Error("Missing comment suggestions migration")
  database
    .prepare("UPDATE __drizzle_migrations SET hash = ? WHERE hash = ? AND created_at = ?")
    .run(
      createHash("sha256").update(migration.sql).digest("hex"),
      "3e6aa3ac60516bdd27edd10c4de906ced19bdbb289c2a2c247a8e7d35a5be083",
      1793445000000,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/adopt-sqlite-ledger.mjs /path/to/drop.db")
  if (!existsSync(process.argv[2])) throw new Error("Database file does not exist")
  const database = new DatabaseSync(process.argv[2])
  try {
    adoptSqliteLedger(database)
  } finally {
    database.close()
  }
}
