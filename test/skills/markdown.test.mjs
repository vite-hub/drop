import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { COMPONENT_TAGS, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const reference = await readFile(new URL("../../skills/vitehub-drop/references/markdown.md", import.meta.url), "utf8")
// Fenced `md` examples, including ````md fences that wrap a ``` block.
const examples = [...reference.matchAll(/^(`{3,})md\n([\s\S]*?)\n\1$/gm)].map((match) => match[2])

test("every component Drop renders is in the Markdown reference agents read", () => {
  const missing = COMPONENT_TAGS.filter((tag) => !reference.includes(tag === "mermaid" ? "```mermaid" : `::${tag}`))
  assert.deepEqual(missing, [])
})

test("every example in the Markdown reference renders without an unsupported component or a problem", async () => {
  assert.ok(examples.length >= 6)
  for (const [index, example] of examples.entries()) {
    const { html } = await renderMarkdownCached(`example-${index}.md`, async () => example)
    assert.doesNotMatch(html, /unsupported-component|render-error|mermaid-error/, example)
  }
})

test("all five GitHub alert kinds keep their label", async () => {
  const kinds = ["note", "tip", "important", "warning", "caution"]
  const markdown = kinds.map((kind) => `> [!${kind.toUpperCase()}]\n> Text.`).join("\n\n")
  const { html } = await renderMarkdownCached("alerts.md", async () => markdown)
  for (const kind of kinds) assert.match(html, new RegExp(`<blockquote as="${kind}">`))
})

test("footnotes link to their definition and back", async () => {
  const { html } = await renderMarkdownCached("footnotes.md", async () => "A claim.[^src]\n\n[^src]: The source.\n")
  assert.match(html, /<sup class="footnote-ref"><a href="#fn-src" id="fnref-src">\[1\]<\/a><\/sup>/)
  assert.match(html, /<li id="fn-src">The source\. <a href="#fnref-src" class="footnote-backref">/)
})

test("a doc written before comark-annotate 0.2 keeps its screenshot's url and label, without a problem", async () => {
  const markdown = [
    '::compare{label="Toolbar"}',
    ':::screenshot{src="/before.png" alt="Before" label="Wrapped" url="https://pr12.example.com/plan"}',
    ":::",
    ':::screenshot{src="/after.png" alt="After"}',
    ":::",
    "::",
  ].join("\n")
  const { html } = await renderMarkdownCached("legacy-props.md", async () => markdown)
  assert.doesNotMatch(html, /render-error/)
  assert.match(html, /href="https:\/\/pr12\.example\.com\/plan"/)
  assert.match(html, /Wrapped/)
})
