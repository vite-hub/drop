import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const databaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME
if (!databaseName) throw new Error("CLOUDFLARE_D1_DATABASE_NAME is required")

const directory = mkdtempSync(join(tmpdir(), "drop-d1-"))
const config = join(directory, "wrangler.json")
writeFileSync(config, JSON.stringify({
  "$schema": "node_modules/wrangler/config-schema.json",
  d1_databases: [{
    binding: "DB",
    database_name: databaseName,
    migrations_dir: resolve("server/databases/migrations"),
  }],
}))

try {
  const result = spawnSync("wrangler", ["d1", "migrations", "apply", "DB", "--remote", "--config", config], { stdio: "inherit" })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
finally {
  rmSync(dirname(config), { recursive: true, force: true })
}
