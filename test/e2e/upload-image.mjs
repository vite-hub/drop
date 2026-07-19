#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const fixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const script = fileURLToPath(new URL("../../skills/upload-image/scripts/upload-image.mjs", import.meta.url))
const output = execFileSync(process.execPath, [script, "-"], { input: fixture, encoding: "utf8" }).trim()

assert.match(output, /^https:\/\/drop\.vitehub\.dev\/i\/[0-9a-f-]+$/)
const response = await fetch(output, { signal: AbortSignal.timeout(30_000) })
assert.equal(response.status, 200)

console.log(`verified permanent Drop URL: ${output}`)
