import { readdir, readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

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
    if (!response.ok || payload.success !== true || !Array.isArray(payload.result) || payload.result.some(result => result.success !== true)) {
      const errors = [...(payload.errors || []), ...(payload.result || []).filter(result => result.error)]
      throw new Error(`D1 migration failed (${response.status}): ${errors.map(error => error.message || error.error).join("; ")}`)
    }
    return payload.result.at(-1)?.results || []
  }

  // Use Wrangler's ledger so either migration command can follow the other.
  await query("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)")
  const applied = new Set((await query("SELECT name FROM d1_migrations")).map(row => row.name))
  const directory = new URL("../server/databases/migrations/", import.meta.url)
  const files = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()
  for (const name of files) {
    if (applied.has(name)) continue
    const sql = await readFile(new URL(name, directory), "utf8")
    // D1 executes the SQL and ledger insert in one request. A failure rolls back both.
    await query(`${sql}\n; INSERT INTO d1_migrations (name) VALUES ('${name.replaceAll("'", "''")}');`)
    console.log(`Applied ${name}`)
  }
  console.log("D1 migrations are up to date")
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) await migrateD1()
