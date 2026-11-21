import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const directory = "server/databases/default/migrations"
const manifest = `${directory}/d1-migrations.json`
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim()

const base = git("merge-base", process.argv[2] ?? "origin/main", "HEAD")
const changed = git("diff", "--name-status", "--no-renames", base, "--", directory)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .filter(
    ([status, path]) => status !== "A" && path !== manifest && !(status === "M" && path.endsWith("/snapshot.json")),
  )

const changedMappings = []
if (git("ls-tree", "--name-only", base, "--", manifest)) {
  const shipped = JSON.parse(git("show", `${base}:${manifest}`))
  const current = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {}
  for (const [tag, name] of Object.entries(shipped)) {
    if (current?.[tag] !== name) changedMappings.push(`${tag} must still map to ${name}`)
  }
}

if (changed.length > 0 || changedMappings.length > 0) {
  console.error("These migrations have shipped, so they can't change. Revert them and add a new migration instead:")
  for (const [status, path] of changed) console.error(`  ${status} ${path}`)
  for (const mapping of changedMappings) console.error(`  ${manifest}: ${mapping}`)
  process.exit(1)
}
