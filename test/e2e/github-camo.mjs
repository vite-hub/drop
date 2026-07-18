#!/usr/bin/env node

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const fixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const script = fileURLToPath(new URL("../../skills/upload-image/scripts/upload-image.mjs", import.meta.url))
const child = spawn(process.execPath, [script, "-"], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
})
const stdout = []
const stderr = []

child.stdout.on("data", chunk => stdout.push(chunk))
child.stderr.on("data", chunk => stderr.push(chunk))
child.stdin.end(fixture)

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject)
  child.once("close", resolve)
})
const output = Buffer.concat(stdout).toString("utf8").trim()
const errors = Buffer.concat(stderr).toString("utf8").trim()

if (exitCode !== 0) {
  throw new Error(`upload-image.mjs exited with ${exitCode}: ${errors}`)
}

if (!output.startsWith("https://camo.githubusercontent.com/")) {
  throw new Error(`upload-image.mjs returned an unexpected Camo URL: ${output}`)
}

const response = await fetch(output, { signal: AbortSignal.timeout(30_000) })

if (!response.ok) throw new Error(`GitHub Camo returned ${response.status}`)

const camoBytes = Buffer.from(await response.arrayBuffer())

if (!camoBytes.equals(fixture)) throw new Error("GitHub Camo bytes differ from the piped image")

console.log(`verified GitHub Camo URL: ${output}`)
