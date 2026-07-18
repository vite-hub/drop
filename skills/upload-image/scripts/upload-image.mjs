#!/usr/bin/env node

import { readFile } from "node:fs/promises"

const input = process.argv[2]
const bytes = input === "-" ? Buffer.concat(await Array.fromAsync(process.stdin)) : await readFile(input)

const form = new FormData()
form.set("image", new File([bytes], "image"))

const uploadResponse = await fetch(new URL("/api/images", process.env.DROP_ORIGIN || "https://drop.vitehub.dev"), {
  method: "POST",
  body: form,
})

if (!uploadResponse.ok) throw new Error(await uploadResponse.text())

const { url } = await uploadResponse.json()
const renderResponse = await fetch("https://api.github.com/markdown", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "gfm", text: `![image](${url})` }),
})

if (!renderResponse.ok) throw new Error(await renderResponse.text())

const html = await renderResponse.text()
const camoUrl = html.match(/src="(https:\/\/camo\.githubusercontent\.com\/[^"]+)"/)?.[1]

if (!camoUrl) throw new Error("GitHub did not return a Camo URL")

console.log(camoUrl)
