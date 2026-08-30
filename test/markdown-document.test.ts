import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { renderMarkdownDocument as renderMarkdownDocumentWithStyles } from "../server/utils/markdown-document.ts"

const pathname = "/i/00000000-0000-4000-8000-000000000000.md"
const styles = await readFile(new URL("../server/assets/typeset.css", import.meta.url), "utf8")

function renderMarkdownDocument(markdown: string, path: string) {
  return renderMarkdownDocumentWithStyles(markdown, path, styles)
}

test("renders frontmatter, Markdown, Comark callouts, and Mermaid", async () => {
  const html = await renderMarkdownDocument(`---
title: Release plan
---

# Ship the renderer

::callout{type="decision"}
Keep the existing endpoint.
::

\`\`\`mermaid
graph LR
  Draft --> Published
\`\`\`
`, pathname)

  assert.match(html, /<title>Release plan · Drop<\/title>/)
  assert.match(html, /<h1 id="ship-the-renderer">Ship the renderer<\/h1>/)
  assert.match(html, /<aside class="callout" data-kind="decision">Keep the existing endpoint\.<\/aside>/)
  assert.match(html, /<div class="mermaid"><svg/)
  assert.match(html, /<article class="typeset typeset-compact">/)
  assert.match(html, /Built with drop\.vitehub\.dev/)
  assert.doesNotMatch(html, /class="site-header"/)
  assert.doesNotMatch(html, /fonts\.googleapis\.com/)
})

test("does not execute raw HTML", async () => {
  const html = await renderMarkdownDocument("---\ntitle: Safe </title><script>\n---\n\n# Safe\n\n<script>alert('no')</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)", pathname)

  assert.doesNotMatch(html, /<script>/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.match(html, /&lt;script&gt;alert\('no'\)&lt;\/script&gt;/)
  assert.match(html, /href="https:\/\/example\.com"/)
})

test("escapes invalid Mermaid source", async () => {
  const html = await renderMarkdownDocument("```mermaid\n<script>alert('no')</script>\n```", pathname)

  assert.match(html, /class="mermaid-error"/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test("replaces unknown Comark components with readable content", async () => {
  const html = await renderMarkdownDocument("::future-widget\nStill readable.\n::", pathname)

  assert.match(html, /<aside class="unsupported-component">\s*Unsupported component: future-widget\. Still readable\.\s*<\/aside>/)
})

test("renders an empty Markdown file as a complete document", async () => {
  const html = await renderMarkdownDocument("", pathname)

  assert.match(html, /<title>Untitled document · Drop<\/title>/)
  assert.match(html, /<p class="empty-document">This document is empty\.<\/p>/)
  assert.match(html, /href="\/i\/00000000-0000-4000-8000-000000000000\.md\?raw"/)
})

test("renders a safe fallback when Comark cannot parse the source", async () => {
  const html = await renderMarkdownDocument("---\ntitle: [\n---\n<script>no</script>", pathname)

  assert.match(html, /Drop could not render this document/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;no&lt;\/script&gt;/)
})

test("links immutable revisions through frontmatter", async () => {
  const previous = "https://drop.vitehub.dev/i/11111111-1111-4111-8111-111111111111.md"
  const html = await renderMarkdownDocument(`---\ntitle: Revision\nsupersedes: ${previous}\n---\n`, pathname)

  assert.match(html, new RegExp(`href="${previous}"`))
  assert.match(html, /Revision of <a/)

  const unsafe = await renderMarkdownDocument("---\nsupersedes: javascript:alert(1)\n---\n", pathname)
  assert.doesNotMatch(unsafe, /javascript:/)
})
