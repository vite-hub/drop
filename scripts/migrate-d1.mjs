import { readdir, readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

const MIGRATIONS = new URL("../server/databases/default/migrations/", import.meta.url)

/**
 * Each migration folder under the `.sql` name Wrangler records it by in `d1_migrations`, in Wrangler's order.
 * d1-migrations.json keeps the names (ViteHub's `vitehub database generate` adds new folders to it), so the folders that
 * `vitehub database up` converted from Drizzle Kit 0.x keep the file names production already applied.
 */
export async function d1Migrations(directory = MIGRATIONS) {
  const names = JSON.parse(await readFile(new URL("d1-migrations.json", directory), "utf8"))
  const folders = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  const unnamed = folders.find((folder) => !Object.hasOwn(names, folder.name))
  if (unnamed) throw new Error(`d1-migrations.json has no name for ${unnamed.name}. Run \`vitehub database generate\`.`)
  return folders
    .map((folder) => ({ name: names[folder.name], file: new URL(`${folder.name}/migration.sql`, directory) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

// Node and Deno can run this without Wrangler or native dependencies.
export async function migrateD1() {
  const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_D1_DATABASE_ID"]
  for (const name of required) {
    if (!process.env[name]?.trim()) throw new Error(`${name} is required`)
  }
  const account = encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID.trim())
  const database = encodeURIComponent(process.env.CLOUDFLARE_D1_DATABASE_ID.trim())
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`
  async function query(sql) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    })
    const payload = await response.json()
    if (
      !response.ok ||
      payload.success !== true ||
      !Array.isArray(payload.result) ||
      payload.result.some((result) => result.success !== true)
    ) {
      const errors = [...(payload.errors || []), ...(payload.result || []).filter((result) => result.error)]
      throw new Error(
        `D1 migration failed (${response.status}): ${errors.map((error) => error.message || error.error).join("; ")}`,
      )
    }
    return payload.result.at(-1)?.results || []
  }

  // Use Wrangler's ledger so either migration command can follow the other.
  await query(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  )
  const applied = new Set((await query("SELECT name FROM d1_migrations")).map((row) => row.name))
  for (const { name, file } of await d1Migrations()) {
    if (applied.has(name)) continue
    const sql = await readFile(file, "utf8")
    // D1 executes the SQL and ledger insert in one request. A failure rolls back both.
    await query(`${sql}\n; INSERT INTO d1_migrations (name) VALUES ('${name.replaceAll("'", "''")}');`)
    console.log(`Applied ${name}`)
  }
  console.log("D1 migrations are up to date")
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await migrateD1()
