import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { adoptSqliteLedger } from "./adopt-sqlite-ledger.mjs"

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function databasePath(url = "file:.data/database/drop.db") {
  if (!url.startsWith("file:")) throw new Error("DROP_DATABASE_URL must be a local file: URL.")
  if (url.startsWith("file://")) return fileURLToPath(url)
  return resolve(decodeURIComponent(url.slice("file:".length).split("?")[0]))
}

async function start() {
  const file =
    readFileSync(join(app, ".output/drop-database"), "utf8").trim() !== "d1" &&
    databasePath(process.env.DROP_DATABASE_URL || undefined)
  if (file && existsSync(file)) {
    const database = new DatabaseSync(file)
    try {
      adoptSqliteLedger(database)
    } finally {
      database.close()
    }
  }
  await import(pathToFileURL(join(app, ".output/server/index.mjs")).href)
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await start()
