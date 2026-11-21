import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

// `pnpm run deploy`. Both paths apply pending D1 migrations before the Worker ships (database.migrateOnDeploy).
// With a local env file, it is `vitehub deploy --host cloudflare`: it builds and uploads only the env names Drop
// declares. Without one, Drop's settings live on the Worker as secrets, as the Deploy button and Workers Builds keep
// them, and `vitehub deploy` would stop at its env check because it needs a local value for each. There it runs the
// deploy command `pnpm build` wrote into .output/nitro.json: `wrangler d1 migrations apply`, then `wrangler deploy`.
const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"]
const result = envFiles.some((file) => existsSync(file))
  ? spawnSync("vitehub", ["deploy", "--host", "cloudflare", ...process.argv.slice(2)], { stdio: "inherit" })
  : spawnSync(JSON.parse(readFileSync(".output/nitro.json", "utf8")).commands.deploy, {
      cwd: ".output",
      shell: true,
      stdio: "inherit",
    })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
