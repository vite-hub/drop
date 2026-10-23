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
  // comark-code adds its own copy-button runtime as a <script>; the fenced one must stay text.
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;<\/span><span[^>]*>script/)
  assert.match(html, /<pre><code>&lt;b&gt;plain&lt;\/b&gt;<\/code><\/pre>/)
  assert.equal(html.match(/class="shiki"/g)?.length, 1)
})
