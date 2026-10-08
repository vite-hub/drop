import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

// The button supplies Worker secrets itself. Terminal deploys can still upload .env.
const args = ["deploy", "--config", ".output/server/wrangler.json"]
if (existsSync(".env")) args.push("--secrets-file", ".env")
const result = spawnSync("wrangler", args, { stdio: "inherit" })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
