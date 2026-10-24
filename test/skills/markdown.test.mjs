import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { afterAll, beforeAll, beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { COMPONENT_TAGS, parseMarkdown, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

// The examples draw icons from the Iconify API and a diagram on Kroki; answer both here, so the test needs no network.
const network = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const icons = url.match(/^https:\/\/api\.iconify\.design\/([\w-]+)\.json\?icons=([^&]+)/)
    if (icons) {
      const body = '<path d="M4 4h16v16H4z"/>'
      const names = Object.fromEntries(icons[2].split(",").map((name) => [name, { body }]))
      return Response.json({ prefix: icons[1], icons: names, width: 24, height: 24 })
    }
    if (url.startsWith("https://kroki.io/"))
      return new Response('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
    return network(input, init)
  }
})
afterAll(() => {
  globalThis.fetch = network
})

const read = (name) => readFile(new URL(`../../skills/vitehub-drop/references/${name}`, import.meta.url), "utf8")
const reference = await read("markdown.md")
const blocks = await read("blocks.md")
// Fenced `md` examples, including ````md fences that wrap a ``` block.
const examples = [reference, blocks].flatMap((text) =>
  [...text.matchAll(/^(`{3,})md\n([\s\S]*?)\n\1$/gm)].map((match) => match[2]),
)

test("every component Drop renders is in the Markdown reference agents read", () => {
  const missing = COMPONENT_TAGS.filter((tag) => !reference.includes(tag === "mermaid" ? "```mermaid" : `::${tag}`))
  assert.deepEqual(missing, [])
})

test("every comark-ui package Drop renders has a section in the Markdown references", () => {
  const preset = createRequire(import.meta.url)("comark-ui/package.json")
  // include reads files, which Drop turns off, reading-time only measures, and Drop draws Mermaid itself, not with pele.
  const packages = Object.keys(preset.dependencies).filter(
    (name) => !["comark-include", "comark-pele", "comark-reading-time"].includes(name),
  )
  const missing = packages.filter(
    (name) => !(reference + blocks).includes(`https://comark-ui.onmax.me/${name.replace(/^comark-/, "")}/`),
  )
  assert.deepEqual(missing, [])
})

test("every example in the Markdown references renders without an unsupported component or a problem", async () => {
  assert.ok(examples.length >= 30)
  for (const [index, example] of examples.entries()) {
    const { html } = await renderMarkdownCached(`example-${index}.md`, async () => example)
    assert.doesNotMatch(html, /unsupported-component|render-error|mermaid-error/, example)
    // A block draws its own parts, so one the allowlist took out can vanish from the HTML without a trace.
    assert.doesNotMatch(JSON.stringify((await parseMarkdown(example)).nodes), /unsupported-component/, example)
  }
})

test("all five GitHub alert kinds keep their label", async () => {
  const kinds = ["note", "tip", "important", "warning", "caution"]
  const markdown = kinds.map((kind) => `> [!${kind.toUpperCase()}]\n> Text.`).join("\n\n")
  const { html } = await renderMarkdownCached("alerts.md", async () => markdown)
  for (const kind of kinds) {
    const label = kind[0].toUpperCase() + kind.slice(1)
    assert.match(html, new RegExp(`<div class="cgc" data-type="${kind}">.*?<p class="cgc-title">${label}</p>`))
  }
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
