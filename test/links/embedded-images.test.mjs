import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { embeddedImagePaths } from "../../shared/embedded-images.ts"

const a = "11111111-1111-4111-8111-111111111111"
const b = "22222222-2222-4222-8222-222222222222"
const c = "33333333-3333-4333-8333-333333333333"

test("a doc's linked screenshots are inlined, not only its attachments", () => {
  // A pr-evidence doc: screenshots published as their own drops, embedded by their absolute fileUrl.
  const markdown = `![Before](https://drop.quiver.dk/f/${a}.png)\n![After](/f/${b}.webp?raw)`
  assert.deepEqual(embeddedImagePaths([markdown], "drop.quiver.dk", [`/f/${c}.png`]), [
    `/f/${c}.png`,
    `/f/${a}.png`,
    `/f/${b}.webp`,
  ])
})

test("other files and other Drops' images stay links", () => {
  const html = `<a href="/f/${a}.zip">logs</a><img src="https://drop.vitehub.dev/f/${b}.png"><img src="https://drop.quiver.dk/f/${c}.png">`
  assert.deepEqual(embeddedImagePaths([html], "drop.quiver.dk"), [`/f/${c}.png`])
})

test("the same image twice is fetched once, and a long doc stops at 60", () => {
  const ids = Array.from({ length: 70 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`)
  const markdown = ids.map((id) => `![](/f/${id}.png)`).join("\n")
  assert.equal(embeddedImagePaths([markdown, markdown], "drop.quiver.dk").length, 60)
  assert.deepEqual(embeddedImagePaths([`![](/f/${a}.png)`, `<img src="/f/${a}.png">`], "x"), [`/f/${a}.png`])
})
