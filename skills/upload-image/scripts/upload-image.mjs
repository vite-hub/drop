#!/usr/bin/env node

import { readFile } from "node:fs/promises"

const origin = process.env.DROP_ORIGIN || "https://drop.vitehub.dev"
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

const { url } = await uploadResponse.json()
if (typeof url !== "string") throw new Error("Drop did not return an image URL.")
console.log(new URL(url, origin).href)
