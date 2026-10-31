import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { afterAll, beforeAll, beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
const { blocksPublishing, COMPONENT_TAGS, lintMarkdown, parseMarkdown, renderMarkdownCached } =
  await import("../../server/utils/markdown-document.ts")

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
  // include reads files, which Drop turns off, reading-time only measures, Drop draws Mermaid itself, not with pele, and
  // the security plugin drops mathml's MathML, so markdown.md lists math under what Drop doesn't render. magic-move's
  // animation needs its script, which /f/ pages block, so blocks.md (a stopgap that doesn't grow) leaves it out.
  const packages = Object.keys(preset.dependencies).filter(
    (name) =>
      !["comark-include", "comark-magic-move", "comark-mathml", "comark-pele", "comark-reading-time"].includes(name),
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

test("every example in the Markdown references publishes without a lint problem", async () => {
  for (const example of examples) assert.deepEqual(await lintMarkdown(example), [], example)
})

test("every rule comark-linter's catalog marks as an error stops a publish", async () => {
  // The linter's index exports rule titles only; its Doctor extension carries each rule's severity.
  const { default: comark } = await import("comark-linter/doctor")
  const rules = comark().rulePacks.flatMap((pack) => pack.rules.map((rule) => rule.meta))
  assert.ok(rules.length > 100 && rules.some((rule) => rule.severity === "error"))
  assert.deepEqual(
    rules.filter((rule) => rule.severity === "error" && !blocksPublishing(rule.id)).map((rule) => rule.id),
    [],
  )
})

test("comark-linter comes from the same comark-ui commit as the renderer", async () => {
  // A linter from another commit checks a different plugin set, so it passes or refuses what Drop doesn't render.
  const { dependencies } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
  const commit = (name) =>
    dependencies[name].match(/^https:\/\/pkg\.pr\.new\/onmax\/comark-ui\/[\w-]+@([0-9a-f]{40})$/)?.[1]
  assert.ok(commit("comark-ui"), dependencies["comark-ui"])
  assert.equal(commit("comark-linter"), commit("comark-ui"))
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
  assert.match(
    html,
    /<sup class="(?:[^" ]+ )*footnote-ref(?: [^" ]+)*"><a href="#fn-src" id="fnref-src">\[1\]<\/a><\/sup>/,
  )
  assert.match(html, /<li id="fn-src">The source\. <a href="#fnref-src" class="footnote-backref">/)
})

test("a link chip with code in its label adds no space after the code", async () => {
  const { html } = await renderMarkdownCached(
    "chip-code.md",
    async () => "Tested on [commit `5b5bd21`](https://github.com/nitrojs/nitro/tree/5b5bd21), built from source.\n",
  )
  assert.match(html, /<a class="cp" [^>]*><img class="cp-img" [^>]*>commit <code>5b5bd21<\/code><\/a>, built/)
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

test("plain Markdown keeps Drop's typography without the preset's typeset stylesheet", async () => {
  const markdown = "# Existing document\n\nA paragraph.\n\n| Name | Value |\n| --- | --- |\n| One | Two |"
  const { title, html } = await renderMarkdownCached("plain.md", async () => markdown)
  assert.equal(title, "Existing document")
  assert.match(html, /<table>/)
  assert.equal(html.includes("data-comark-typeset"), false, "Drop already supplies its own typography CSS")
})

test("a suggestion, a comment, and its reply render their marks, bubbles, and card through the allowlist", async () => {
  const markdown = [
    "# Review **copy**",
    "",
    'To :suggestion[sign in]{from="log in" by="Claude" note="The button says Sign in."}, enter your email.',
    "",
    'The link expires after :comment[15 minutes]{#ttl by="@onmax" note="Is 15 minutes enough when email is slow?"}.',
    "",
    ':comment{reply="ttl" by="Claude" note="Keeping 15. The email has a resend button."}',
  ].join("\n")
  const document = await parseMarkdown(markdown)
  assert.deepEqual(document.meta.issues ?? [], [])
  const { title, html } = await renderMarkdownCached("comments.md", async () => markdown)
  assert.equal(title, "Review copy")
  assert.doesNotMatch(html, /unsupported-component|render-error/)
  assert.match(html, /<style data-comark-comments>/)
  assert.match(html, /<div class="cr">/)
  assert.match(
    html,
    /<span class="cr-sg" data-mark="track" data-kind="replace"><del>log in<\/del><ins>sign in<\/ins><\/span>/,
  )
  assert.match(html, /<mark class="cr-cm" id="ttl">15 minutes<\/mark>/)
  // Each thread is a hidden checkbox and the bubble that labels it, so a click opens the card without a script.
  const toggles = [
    ...html.matchAll(
      /<input class="cr-tg" type="checkbox" id="([^"]+)" aria-label="[^"]+"><label class="cr-bub" for="\1">(\d*)<\/label><span class="cr-card" role="note">(.*?)<\/span><\/span>/g,
    ),
  ]
  assert.equal(toggles.length, 2)
  // The reply joins the comment's card, so the bubble counts two and the paragraph it sat in is gone.
  assert.equal(toggles[1][2], "2")
  assert.match(toggles[1][3], /onmax<\/b>Is 15 minutes enough.*Claude<\/b>Keeping 15/)
  assert.doesNotMatch(html, /reply=/)
})

test("a doc's problems open in a foldable box that counts them and shows the Markdown they quote as code", async () => {
  const { html } = await renderMarkdownCached("problems.md", async () => "# Quiz\n\n::question\nWhy?\n::\n")
  assert.match(html, /<details class="render-error" open><summary>.*<span>This doc has 2 problems<\/span>/)
  assert.match(html, /<li><code>::question<\/code> #1 has no options\./)
  assert.doesNotMatch(html, /<li>[^<]*`/)
})

test("::drop leaves a box with only the link, which the viewer fills for readers who may open it", async () => {
  const { html } = await renderMarkdownCached(
    "embed.md",
    async () =>
      '::drop{link=https://drop.vitehub.dev/d/k7f2q9m4x8wd/steps height=9999 title="Steps <b>"}\n::\n\n::drop{link=nope}\n::',
  )
  assert.match(
    html,
    /<figure class="drop-embed" data-drop-embed="k7f2q9m4x8wd" data-title="Steps &lt;b&gt;" style="--drop-embed-height: 1600px"><a class="drop-embed-link" href="\/d\/k7f2q9m4x8wd">Steps &lt;b&gt;<\/a><\/figure>/,
  )
  assert.match(html, /<code>::drop<\/code> needs the link/)
  assert.doesNotMatch(html, /<iframe|unsupported-component/)
})
