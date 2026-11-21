import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

const args = ["deploy", "--config", ".output/server/wrangler.json"]
if (existsSync(".env")) args.push("--secrets-file", ".env")
const result = spawnSync("wrangler", args, { stdio: "inherit" })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
