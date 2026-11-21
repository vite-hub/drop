import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vite-plus/test"

const script = fileURLToPath(new URL("../../scripts/deploy-cloudflare.mjs", import.meta.url))

function project(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "drop-deploy-")))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  mkdirSync(join(dir, ".output"))
  // Stands in for the ViteHub CLI and records what it was asked to do.
  writeFileSync(join(bin, "vitehub"), `#!/bin/sh\necho "$@" > "${join(dir, "vitehub-args")}"\n`)
  chmodSync(join(bin, "vitehub"), 0o755)
  const record = `node -e "require('fs').writeFileSync('../ran-in', process.cwd())"`
  writeFileSync(join(dir, ".output/nitro.json"), JSON.stringify({ commands: { deploy: record } }))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  const run = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    })
  return { dir, run }
}

test("a terminal deploy with a .env is vitehub deploy", () => {
  const { dir, run } = project({ ".env": "BETTER_AUTH_SECRET=x\n" })
  try {
    run("--yes")
    assert.equal(readFileSync(join(dir, "vitehub-args"), "utf8").trim(), "deploy --host cloudflare --yes")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("without a local env file it runs the build's deploy command from .output", () => {
  const { dir, run } = project({})
  try {
    run()
    assert.equal(readFileSync(join(dir, "ran-in"), "utf8"), join(dir, ".output"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
