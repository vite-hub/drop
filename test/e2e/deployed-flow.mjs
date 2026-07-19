#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const run = promisify(execFile)
const origin = process.env.DROP_ORIGIN || "https://drop.vitehub.dev"
const script = fileURLToPath(new URL("../../skills/upload-image/scripts/upload-image.mjs", import.meta.url))
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

const orientedJpeg = await sharp({
  create: { background: { b: 190, g: 110, r: 35 }, channels: 3, height: 1200, width: 3200 },
})
  .jpeg({ quality: 95 })
  .withExif({ IFD0: { Copyright: "ViteHub Drop deployed-flow test" } })
  .withMetadata({ orientation: 6 })
  .toBuffer()

const fixtureDirectory = await mkdtemp(join(tmpdir(), "vitehub-drop-e2e-"))
const fixturePath = join(fixtureDirectory, "oriented.jpg")
await writeFile(fixturePath, orientedJpeg)
const { stdout } = await run(process.execPath, [script, fixturePath], {
  env: { ...process.env, DROP_ORIGIN: origin },
  maxBuffer: 1024 * 1024,
  timeout: 6 * 60_000,
}).finally(() => rm(fixtureDirectory, { force: true, recursive: true }))
const permanentUrl = stdout.trim()
assert.match(permanentUrl, new RegExp(`^${escapeRegExp(origin)}/i/[0-9a-f-]{36}$`))

const imageId = permanentUrl.split("/").at(-1)
const largeJob = await getJson(new URL(`/api/images/${imageId}`, origin))
assert.equal(largeJob.status, "complete")
assert.equal(largeJob.optimized, true)
assert.ok(largeJob.finalSize < orientedJpeg.byteLength)
assert.equal(largeJob.savedBytes, orientedJpeg.byteLength - largeJob.finalSize)

const imageResponse = await fetch(permanentUrl, { signal: AbortSignal.timeout(30_000) })
assert.equal(imageResponse.status, 200)
assert.equal(imageResponse.headers.get("content-type"), "image/jpeg")
assert.match(imageResponse.headers.get("cache-control") || "", /immutable/)
const finalImage = Buffer.from(await imageResponse.arrayBuffer())
const metadata = await sharp(finalImage).metadata()
assert.ok(Math.max(metadata.width, metadata.height) <= 2048)
assert.equal(metadata.orientation, undefined)
assert.equal(metadata.exif, undefined)

const tinyUpload = await upload(tinyPng)
const tinyJob = await poll(tinyUpload.statusUrl)
assert.equal(tinyJob.optimized, false)
assert.equal(tinyJob.originalSize, tinyPng.byteLength)
assert.equal(tinyJob.finalSize, tinyPng.byteLength)
assert.equal(tinyJob.savedBytes, 0)
const tinyResponse = await fetch(tinyJob.url)
assert.deepEqual(Buffer.from(await tinyResponse.arrayBuffer()), tinyPng)

const stats = await pollStats(largeJob.savedBytes)
assert.ok(stats.uploads >= 2)
assert.ok(stats.savedBytes >= largeJob.savedBytes)

let rateLimited = false
for (let attempt = 0; attempt < 5; attempt++) {
  const response = await fetch(new URL("/api/images", origin), {
    body: new FormData(),
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 429) {
    assert.ok(Number(response.headers.get("Retry-After")) > 0)
    rateLimited = true
    break
  }
  assert.equal(response.status, 400)
}
assert.equal(rateLimited, true)

console.log(JSON.stringify({
  finalBytes: largeJob.finalSize,
  originalBytes: largeJob.originalSize,
  permanentUrl,
  savedBytes: largeJob.savedBytes,
  savingsPercent: Math.round(largeJob.savedBytes / largeJob.originalSize * 100),
}))

async function upload(bytes) {
  const form = new FormData()
  form.set("image", new File([bytes], "image"))
  const response = await fetch(new URL("/api/images", origin), {
    body: form,
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  })
  await assertOk(response)
  return response.json()
}

async function poll(statusUrl) {
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const response = await fetch(statusUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) })
    await assertOk(response)
    const job = await response.json()
    if (job.status === "complete") return job
    if (job.status === "failed") assert.fail(job.error)
    await new Promise(resolve => setTimeout(resolve, Number(response.headers.get("Retry-After") || 1) * 1_000))
  }
  assert.fail("Image optimization did not finish within five minutes.")
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) })
  await assertOk(response)
  return response.json()
}

async function pollStats(savedBytes) {
  const deadline = Date.now() + 70_000
  while (Date.now() < deadline) {
    const stats = await getJson(new URL(`/api/stats?fresh=${Date.now()}`, origin))
    if (stats.uploads >= 2 && stats.savedBytes >= savedBytes) return stats
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  assert.fail("Savings statistics did not become visible within 70 seconds.")
}

async function assertOk(response) {
  if (!response.ok) assert.fail(`${response.status}: ${await response.text()}`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
