import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "./harness.mjs"
const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const render = async (markdown) => (await renderMarkdownCached("doc.md", async () => markdown)).html

test("a fenced block in a known language gets Shiki colors for light and dark", async () => {
  const html = await render("```ts {2}\nconst a = 1\nwatch(() => a)\n```")
  assert.match(html, /<pre[^>]*class="shiki"/)
  assert.match(html, /<span style="color:#[0-9A-F]{6};--shiki-dark:#[0-9A-F]{6}">const<\/span>/i)
  assert.match(html, /class="line highlight"/)
})

test("code stays escaped, and unknown or unlabelled fences stay plain", async () => {
  const html = await render(
    "```html\n<script>alert(1)</script>\n```\n\n```\n<b>plain</b>\n```\n\n```brainfuck\n+++\n```",
  )
  // comark-code's own script for the Copy and Wrap buttons is the page's only one.
  assert.doesNotMatch(html, /<script>alert/)
  assert.equal(html.match(/<script>/g)?.length, 1)
  assert.match(html, /&lt;<\/span><span[^>]*>script/)
  assert.match(html, /<pre><code>&lt;b&gt;plain&lt;\/b&gt;<\/code><\/pre>/)
  assert.equal(html.match(/class="shiki"/g)?.length, 1)
})

test("a doc's code past 200,000 characters stays plain, so a huge dump can't eat the Worker's CPU", async () => {
  const block = "```ts\n" + "const a = 1\n".repeat(12_000) + "```"
  const html = await render(`${block}\n\n${block}`)
  assert.equal(html.match(/class="shiki"/g)?.length, 1)
  assert.equal(html.match(/<pre/g)?.length, 2)
})
