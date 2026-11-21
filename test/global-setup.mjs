import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

// Tests that import app code resolve Nuxt's generated tsconfigs. An install that skipped postinstall leaves none, and
// every such file fails with `Tsconfig not found` before an assertion runs.
export default function setup() {
  if (existsSync(".nuxt/tsconfig.json")) return
  execFileSync("pnpm", ["run", "postinstall"], { stdio: "inherit" })
}
