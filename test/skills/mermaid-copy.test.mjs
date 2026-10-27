import assert from "node:assert/strict"
import { decodeHTML } from "entities"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const render = async (source) => (await renderMarkdownCached("mermaid-copy.md", async () => source)).html

test("Mermaid preserves its source as escaped text and loads copy controls once per document", async () => {
  const source = 'graph TD\n A["A & B"] --> B["Copy <text>"]\n'
  const html = await render(("```mermaid\n" + source + "```\n\n").repeat(2))
  const sources = [...html.matchAll(/<figure class="drop-mermaid" data-source="([^"]*)">/g)]
  assert.equal(sources.length, 2)
  for (const [, escaped] of sources) assert.equal(decodeHTML(escaped), source)
  assert.equal([...html.matchAll(/<script>/g)].length, 1)
  assert.match(html, /Copy image/)
  assert.match(html, /Copy Markdown/)
  assert.match(html, /<div class="mermaid"><svg/)
  assert.doesNotMatch(html, /@import url/)
})

test("Mermaid's render limits still leave excess and invalid diagrams as selectable source", async () => {
  const html = await render("```mermaid\ngraph LR\n A --> B\n```\n\n".repeat(5))
  assert.equal([...html.matchAll(/<figure class="drop-mermaid"/g)].length, 4)
  assert.equal([...html.matchAll(/<pre class="mermaid-error">/g)].length, 1)
})

test("invalid Mermaid has no copy-image controls", async () => {
  const html = await render("```mermaid\nnot a diagram\n```")
  assert.match(html, /mermaid-error/)
  assert.doesNotMatch(html, /drop-mermaid|Copy image/)
})

test("a diagram label cannot inject markup through its preserved source", async () => {
  const html = await render('```mermaid\ngraph LR\n A["&quot;><img src=x onerror=alert(1)>"] --> B\n```')
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /data-source=/)
})
