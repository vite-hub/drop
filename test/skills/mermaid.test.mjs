import assert from "node:assert/strict"
import { decodeHTML } from "entities"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { renderMarkdownCached, RENDERER_SCRIPTS } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const render = async (source) => (await renderMarkdownCached("mermaid.md", async () => source)).html

test("comark-ui draws Mermaid with its source, copy buttons, and zoom, from scripts the CSP allows", async () => {
  const source = 'graph TD\n A["A & B"] --> B["Copy <text>"]\n'
  const html = await render(("```mermaid\n" + source + "```\n\n").repeat(2))
  const sources = [...html.matchAll(/<div class="cmm" data-wide style="--cmm-svg:(\d+)px" data-source="([^"]*)">/g)]
  assert.equal(sources.length, 2)
  for (const [, width, escaped] of sources) {
    assert.equal(decodeHTML(escaped), source)
    assert.ok(Number(width) > 0, "the diagram carries its own width")
  }
  // Copy buttons and comark-zoom, once per document.
  assert.equal([...html.matchAll(/<script>/g)].length, 2)
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.ok(RENDERER_SCRIPTS.includes(script), "every renderer script is allowed by the CSP")
  }
  assert.match(html, /Copy image/)
  assert.match(html, /<div data-zoom tabindex="0" class="pele-diagram"/)
})

test("Mermaid past a doc's limits shows its source as code and says why above the doc", async () => {
  const html = await render("```mermaid\ngraph LR\n A --> B\n```\n\n".repeat(5))
  assert.equal([...html.matchAll(/<div class="cmm"/g)].length, 4)
  assert.match(html, /class="render-error"[\s\S]*Mermaid diagram 5 shows its source as code/)
})

test("invalid Mermaid shows its source", async () => {
  const html = await render("```mermaid\nnot a diagram\n```")
  assert.match(html, /<div class="pele-diagram" data-error="[^"]+"><pre class="pele-source"><code>not a diagram/)
})

test("a diagram label cannot inject markup through its preserved source", async () => {
  const html = await render('```mermaid\ngraph LR\n A["&quot;><img src=x onerror=alert(1)>"] --> B\n```')
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /data-source=/)
})

test("a frontmatter date gets comark-properties' locale script, which the CSP allows", async () => {
  const html = await render("---\ndate: 2026-10-23\n---\n\nBody\n")
  assert.match(html, /<time datetime="2026-10-23">\s*Oct 23, 2026\s*<\/time>/)
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script)
  assert.ok(scripts.some((script) => script.includes("localizeDates")))
  for (const script of scripts)
    assert.ok(RENDERER_SCRIPTS.includes(script), "every renderer script is allowed by the CSP")
})

test("a doc past the Mermaid limits still publishes, with a warning", async () => {
  const { lintMarkdown } = await import("../../server/utils/markdown-document.ts")
  const problems = await lintMarkdown("```mermaid\ngraph LR\n A --> B\n```\n\n".repeat(5))
  assert.deepEqual(
    problems.map(({ rule, severity }) => [rule, severity]),
    [["comark/mermaid/too-many-diagrams", "warning"]],
  )
})
