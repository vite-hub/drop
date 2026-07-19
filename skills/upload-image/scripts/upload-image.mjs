#!/usr/bin/env node

import { readFile } from "node:fs/promises"

const input = process.argv[2]
const bytes = input === "-" ? Buffer.concat(await Array.fromAsync(process.stdin)) : await readFile(input)

const form = new FormData()
form.set("image", new File([bytes], "image"))

const response = await fetch(
  new URL("/api/images", process.env.DROP_ORIGIN || "https://drop.vitehub.dev"),
  { method: "POST", body: form, }
)
if (!response.ok) throw new Error(await response.text())

const { url } = await response.json()
console.log(url)
