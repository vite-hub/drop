import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const origin = new URL(process.env.DROP_URL ?? "https://drop.vitehub.dev")
const filesEndpoint = new URL("/api/files", origin)
const homepage = await fetch(origin, { signal: AbortSignal.timeout(30_000) })

assert.equal(homepage.status, 200)

const mediumZoom = await fetch(new URL("/vendor/medium-zoom/medium-zoom.min.js", origin), { signal: AbortSignal.timeout(30_000) })
assert.equal(mediumZoom.status, 200)
assert.match(await mediumZoom.text(), /medium-zoom-image/)

const form = new FormData()
form.set("file", new File([await readFile(new URL("../../public/og-vitehub-drop.png", import.meta.url))], "og-vitehub-drop.png"))

const { url } = await (await fetch(filesEndpoint, { body: form, method: "POST", signal: AbortSignal.timeout(30_000) })).json()
assert.equal(new URL(url).pathname.endsWith(".png"), true)
const image = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(30_000) })
const stats = await fetch(new URL("/api/stats", origin), { signal: AbortSignal.timeout(30_000) })

assert.equal(image.status, 200)
assert.equal(image.headers.get("content-type"), "image/png")
assert.ok(await stats.json() > 0)

const markdownSource = "---\ntitle: Smoke-test plan\n---\n\n# Smoke-test plan\n\n```mermaid\ngraph LR\n  Upload --> Render\n```\n"
const markdownForm = new FormData()
markdownForm.set("file", new File([markdownSource], "plan.md", { type: "text/markdown" }))
const markdownUpload = await fetch(filesEndpoint, { body: markdownForm, method: "POST", signal: AbortSignal.timeout(30_000) })
assert.equal(markdownUpload.status, 200)

const markdownUrl = new URL((await markdownUpload.json()).url, origin)
assert.match(markdownUrl.pathname, /^\/i\/[0-9a-f-]+\.md$/)

const markdownPage = await fetch(markdownUrl, { signal: AbortSignal.timeout(30_000) })
assert.equal(markdownPage.status, 200)
assert.equal(markdownPage.headers.get("content-type"), "text/html; charset=utf-8")
assert.match(await markdownPage.text(), /<div class="mermaid" data-zoomable><svg/)
assert.match(markdownPage.headers.get("content-security-policy"), /script-src 'self'/)

markdownUrl.search = "?raw"
const markdownRaw = await fetch(markdownUrl, { signal: AbortSignal.timeout(30_000) })
assert.equal(markdownRaw.status, 200)
assert.match(markdownRaw.headers.get("content-type") ?? "", /^text\/markdown/)
assert.equal(await markdownRaw.text(), markdownSource)

const codeResponse = await fetch(new URL("/api/code", origin), {
  body: JSON.stringify({ code: "const answer: number = 42", language: "typescript", theme: "nuxt" }),
  headers: { "content-type": "application/json" },
  method: "POST",
  signal: AbortSignal.timeout(120_000),
})
assert.equal(codeResponse.status, 200)

const codeImage = await fetch(new URL((await codeResponse.json()).url, origin), {
  signal: AbortSignal.timeout(30_000),
})
assert.equal(codeImage.status, 200)
assert.equal(codeImage.headers.get("content-type"), "image/png")
assert.deepEqual(
  Buffer.from(await codeImage.arrayBuffer()).subarray(0, 8),
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
)
