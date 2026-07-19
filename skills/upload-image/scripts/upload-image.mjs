#!/usr/bin/env node

import { readFile } from "node:fs/promises"

const origin = process.env.DROP_ORIGIN || "https://drop.vitehub.dev"
const timeout = Number(process.env.DROP_POLL_TIMEOUT_MS || 5 * 60_000)
const input = process.argv[2]
if (!input) throw new Error("Usage: upload-image.mjs <image-path|->")

const bytes = input === "-" ? Buffer.concat(await Array.fromAsync(process.stdin)) : await readFile(input)
const form = new FormData()
form.set("image", new File([bytes], "image"))

const uploadResponse = await fetch(new URL("/api/images", origin), {
  body: form,
  method: "POST",
  signal: AbortSignal.timeout(30_000),
})
if (!uploadResponse.ok) throw new Error(await uploadResponse.text())

const { statusUrl } = await uploadResponse.json()
if (typeof statusUrl !== "string") throw new Error("Drop did not return an image job URL.")

const deadline = Date.now() + timeout
while (Date.now() < deadline) {
  const response = await fetch(statusUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(await response.text())

  const job = await response.json()
  if (job.status === "complete" && typeof job.url === "string") {
    console.log(job.url)
    process.exit(0)
  }
  if (job.status === "failed") throw new Error(job.error || "Image optimization failed.")

  const retryAfter = Number(response.headers.get("Retry-After"))
  await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 1_000))
}

throw new Error(`Image optimization did not finish within ${timeout}ms.`)
