import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const endpoint = new URL("https://drop.vitehub.dev/api/files")
const homepage = await fetch(new URL("/", endpoint), { signal: AbortSignal.timeout(30_000) })

assert.equal(homepage.status, 200)

const form = new FormData()
form.set("file", new File([await readFile(new URL("../../public/og-vitehub-drop.png", import.meta.url))], "og-vitehub-drop.png"))

const { url } = await (await fetch(endpoint, { body: form, method: "POST", signal: AbortSignal.timeout(30_000) })).json()
const image = await fetch(new URL(url, endpoint), { signal: AbortSignal.timeout(30_000) })
const stats = await fetch(new URL("/api/stats", endpoint), { signal: AbortSignal.timeout(30_000) })

assert.equal(image.status, 200)
assert.equal(image.headers.get("content-type"), "image/png")
assert.ok(await stats.json() > 0)
