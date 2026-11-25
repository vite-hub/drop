import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

function wrangler(args, env) {
  const bin = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js")
  const result = spawnSync(process.execPath, [bin, ...args], { env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} exited with ${result.status ?? result.signal}`)
}

export async function migrateWorkersBuild(
  env = process.env,
  configPath = ".output/server/wrangler.json",
  run = wrangler,
) {
  const productionBranch = env.DROP_PRODUCTION_BRANCH
  if (env.WORKERS_CI !== "1" || !productionBranch || env.WORKERS_CI_BRANCH !== productionBranch) return

  const config = JSON.parse(await readFile(configPath, "utf8"))
  const databaseId = config.d1_databases?.find(({ binding }) => binding === "DB")?.database_id?.trim()
  if (!databaseId || databaseId === "00000000-0000-4000-8000-000000000000") {
    throw new Error(
      `No deployed D1 database ID for DB in ${configPath}; configure CLOUDFLARE_D1_DATABASE_ID or wrangler.jsonc`,
    )
  }

  const token = env.DROP_D1_MIGRATION_TOKEN?.trim() || env.CLOUDFLARE_API_TOKEN?.trim()
  const tokenHint = "Set the DROP_D1_MIGRATION_TOKEN build secret or use a Workers Builds API token with D1 Write"
  if (!token) throw new Error(tokenHint)
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim())
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID in Workers Builds to the account that owns DB")

  try {
    run(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath], {
      ...env,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID.trim(),
      CLOUDFLARE_API_TOKEN: token,
    })
  } catch (cause) {
    throw new Error(`Workers Builds D1 migration failed. If authorization failed: ${tokenHint}.`, { cause })
  }
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  await migrateWorkersBuild()
}
