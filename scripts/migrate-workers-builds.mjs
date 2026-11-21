import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { migrateD1 } from "./migrate-d1.mjs"

// Workers Builds' default deploy command, `npx wrangler deploy`, ships a Worker without applying D1 migrations,
// so a merged migration took production down five times. The build runs on every host, so it migrates only for a
// Workers Builds build of the production branch, before the deploy step uploads code that needs the new schema.
// Preview branches skip it: they would migrate the production database for a branch nobody merged.
export async function migrateWorkersBuild(env = process.env, configPath = ".output/server/wrangler.json") {
  if (env.WORKERS_CI !== "1" || env.WORKERS_CI_BRANCH !== (env.DROP_PRODUCTION_BRANCH || "main")) return

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
    await migrateD1({
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_D1_DATABASE_ID: databaseId,
    })
  } catch (cause) {
    throw new Error(`Workers Builds D1 migration failed. If authorization failed: ${tokenHint}.`, { cause })
  }
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  await migrateWorkersBuild()
}
