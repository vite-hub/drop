// Fails when a change edits, renames or deletes a migration that is already on the base branch. D1 and SQLite record a
// migration by name once it runs, so an edited one never runs again where it has shipped (drop#28).
// Usage: node scripts/check-migrations.mjs [base], default origin/main. Compares the working tree with the merge base.
import { execFileSync } from "node:child_process"

const directory = "server/databases/default/migrations"
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()

const base = git("merge-base", process.argv[2] ?? "origin/main", "HEAD")
const changed = git("diff", "--name-status", "--no-renames", base, "--", directory)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .filter(([status, path]) => status !== "A" && path !== `${directory}/d1-migrations.json`)

if (changed.length > 0) {
  console.error("These migrations have shipped, so they can't change. Revert them and add a new migration instead:")
  for (const [status, path] of changed) console.error(`  ${status} ${path}`)
  process.exit(1)
}
