#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const execFileAsync = promisify(execFile)
const origin = process.env.DROP_ORIGIN || "https://drop.vitehub.dev"
const script = fileURLToPath(new URL("../../skills/upload-image/scripts/upload-image.mjs", import.meta.url))
const uploadsBefore = await getUploads()
const original = await sharp({
  create: { background: { b: 190, g: 110, r: 35 }, channels: 3, height: 1200, width: 3200 },
})
  .jpeg({ quality: 95 })
  .withExif({ IFD0: { Copyright: "ViteHub Drop deployed-flow test" } })
  .withMetadata({ orientation: 6 })
  .toBuffer()

const fixtureDirectory = await mkdtemp(join(tmpdir(), "vitehub-drop-e2e-"))
const fixturePath = join(fixtureDirectory, "oriented.jpg")
await writeFile(fixturePath, original)
const { stdout } = await execFileAsync(process.execPath, [script, fixturePath], {
  env: { ...process.env, DROP_ORIGIN: origin },
  maxBuffer: 1024 * 1024,
  timeout: 30_000,
}).finally(() => rm(fixtureDirectory, { force: true, recursive: true }))

const permanentUrl = stdout.trim()
assert.match(permanentUrl, new RegExp(`^${escapeRegExp(origin)}/i/[0-9a-f-]{36}$`))
const optimized = await waitForOptimizedImage(permanentUrl, original.byteLength)
const metadata = await sharp(optimized).metadata()
assert.ok(Math.max(metadata.width, metadata.height) <= 2048)
assert.equal(metadata.orientation, undefined)
assert.equal(metadata.exif, undefined)
await waitForUploadCount(uploadsBefore + 1)
await verifyRateLimit()

console.log(JSON.stringify({ originalBytes: original.byteLength, optimizedBytes: optimized.byteLength, permanentUrl }))

async function waitForOptimizedImage(url, originalSize) {
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "image/jpeg")
    assert.match(response.headers.get("cache-control") || "", /no-cache/)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength < originalSize) return bytes
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  assert.fail("Image optimization did not finish within five minutes.")
}

async function getUploads() {
  const response = await fetch(new URL(`/api/stats?fresh=${Date.now()}`, origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(response.status, 200)
  const uploads = await response.json()
  assert.ok(Number.isSafeInteger(uploads))
  return uploads
}

async function waitForUploadCount(expected) {
  const deadline = Date.now() + 70_000
  while (Date.now() < deadline) {
    if (await getUploads() >= expected) return
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  assert.fail("The upload count did not become visible within 70 seconds.")
}

async function verifyRateLimit() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(new URL("/api/images", origin), {
      body: new FormData(),
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 429) {
      return
    }
    assert.equal(response.status, 400)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.fail("The upload attempts were not rate limited.")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
