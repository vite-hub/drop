// Starts a built Drop image the way a self-hoster does, with only the settings it needs, and checks that it answers.
// With a previous image, it first runs that one on the same volume, then upgrades: the new image must start on the old
// data, keep it, and back the database up when it brings migrations.
//
//   node test/deploy/image-smoke.mjs <image> [previous-image]

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

const [image, previous] = process.argv.slice(2)
if (!image) throw new Error("Usage: node test/deploy/image-smoke.mjs <image> [previous-image]")

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
const run = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim()
const name = `drop-smoke-${randomBytes(4).toString("hex")}`
const volume = `${name}-data`
const settings = [
  "-e",
  `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  "-e",
  "DROP_ADMINS=admin@example.com",
]

async function start(tag) {
  run("run", "-d", "--name", name, "-p", "127.0.0.1::3000", "-v", `${volume}:/app/.data`, ...settings, tag)
  const port = run("port", name, "3000").split(":").at(-1)
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return await response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${tag} did not answer /api/health within 90 s:\n${run("logs", name)}`)
}

function stop() {
  const logs = run("logs", name)
  run("rm", "-f", name)
  return logs
}

// Reads the volume with the new image's own Node, which has node:sqlite.
const query = (sql) =>
  run(
    "run",
    "--rm",
    "-v",
    `${volume}:/app/.data`,
    "--entrypoint",
    "node",
    image,
    "-e",
    `const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".data/database/drop.db"); ` +
      `const rows = db.prepare(${JSON.stringify(sql)}).all(); console.log(JSON.stringify(rows))`,
  )

try {
  if (previous) {
    await start(previous)
    stop()
    query("CREATE TABLE smoke_marker (value TEXT)")
    query("INSERT INTO smoke_marker VALUES ('from the previous image') RETURNING value")
  }
  const health = await start(image)
  assert.equal(health.ok, true)
  assert.equal(health.version, version)
  const logs = stop()
  if (previous) {
    assert.deepEqual(JSON.parse(query("SELECT value FROM smoke_marker")), [{ value: "from the previous image" }])
    const backup = logs.match(/backed up the database to (\S+)/)?.[1]
    if (backup) {
      run("run", "--rm", "-v", `${volume}:/app/.data`, "--entrypoint", "test", image, "-s", backup)
      console.log(`Upgrade from ${previous}: data kept, backup at ${backup}`)
    } else console.log(`Upgrade from ${previous}: data kept, no new migrations`)
  }
  console.log(`${image} answers /api/health as Drop ${health.version}${health.commit ? ` (${health.commit})` : ""}`)
} finally {
  execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" })
  execFileSync("docker", ["volume", "rm", "-f", volume], { stdio: "ignore" })
}
