import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { lintMarkdown, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const render = async (key, source) => (await renderMarkdownCached(key, async () => source)).html
const doc = [
  "# Growth",
  "",
  "Output is $Y = A K^\\alpha L^{1-\\alpha}$, and bread costs $5 and $10.",
  "",
  "$$",
  "\\frac{\\dot{k}}{k} = s A k^{\\alpha - 1} - (n + \\delta)",
  "$$",
  "",
  "```math",
  "\\sum_{t=0}^{\\infty} \\beta^t u(c_t)",
  "```",
  "",
].join("\n")

test("a doc's inline, display, and fenced math render as MathML, with prices left as text", async () => {
  const html = await render("math.md", doc)
  assert.equal(html.match(/<span class="cmh"><math>/g)?.length, 1)
  assert.equal(html.match(/<span class="cmh cmh-display"><math display="block"/g)?.length, 2)
  assert.match(html, /<annotation encoding="application\/x-tex">Y = A K\^\\alpha L\^\{1-\\alpha\}<\/annotation>/)
  assert.match(html, /bread costs \$5 and \$10\./)
  assert.doesNotMatch(html, /cmh cmh-source|render-error|unsupported-component/)
})

test("a doc with math publishes without a lint problem", async () => {
  assert.deepEqual(await lintMarkdown(doc), [])
})

test("a doc without math carries no math styles", async () => {
  const html = await render("plain.md", "# Plain\n\nNo formulas, only $5 and $10.\n")
  assert.doesNotMatch(html, /data-comark-mathml|<math/)
})
