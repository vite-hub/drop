import { pathToFileURL } from "node:url"
import { migrateD1 } from "./migrate-d1.mjs"

// Workers Builds' default deploy command, `npx wrangler deploy`, ships a Worker without applying D1 migrations,
// so a merged migration took production down five times. The build runs on every host, so it migrates only for a
// Workers Builds build of the production branch, before the deploy step uploads code that needs the new schema.
// Preview branches skip it: they would migrate the production database for a branch nobody merged.
export function shouldMigrate(env = process.env) {
  if (env.WORKERS_CI !== "1") return false
  if (env.WORKERS_CI_BRANCH !== (env.DROP_PRODUCTION_BRANCH || "main")) return false
  return Boolean(env.CLOUDFLARE_D1_DATABASE_ID?.trim())
}

if (import.meta.main || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  if (shouldMigrate()) await migrateD1()
}
