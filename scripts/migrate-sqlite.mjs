import { mkdir, readdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

const url = process.env.DROP_DATABASE_URL
if (!url?.startsWith("file:")) throw new Error("DROP_DATABASE_URL must be a local file: URL")
const path = url.slice(5)
await mkdir(dirname(path), { recursive: true })
const db = new DatabaseSync(path)
try {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL")
  db.exec("CREATE TABLE IF NOT EXISTS drop_migrations (name TEXT PRIMARY KEY)")
  const directory = new URL("../server/databases/migrations/", import.meta.url)
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    if (db.prepare("SELECT 1 FROM drop_migrations WHERE name = ?").get(name)) continue
    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(await readFile(new URL(name, directory), "utf8"))
      db.prepare("INSERT INTO drop_migrations (name) VALUES (?)").run(name)
      db.exec("COMMIT")
      console.log(`Applied ${name}`)
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
} finally {
  db.close()
}
