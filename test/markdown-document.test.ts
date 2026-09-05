import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { renderMarkdownDocument as renderMarkdownDocumentWithStyles } from "../server/utils/markdown-document.ts"

const pathname = "/i/00000000-0000-4000-8000-000000000000.md"
const styles = await readFile(new URL("../server/assets/typeset.css", import.meta.url), "utf8")
const zoomScript = await readFile(new URL("../public/document-zoom.js", import.meta.url), "utf8")

function renderMarkdownDocument(markdown: string, path: string) {
  return renderMarkdownDocumentWithStyles(markdown, path, styles)
}

test("does not frame Mermaid diagrams twice", () => {
  const mermaidStyles = styles.match(/\.typeset \.mermaid \{([\s\S]*?)\}/)?.[1]
  assert.ok(mermaidStyles)
  assert.doesNotMatch(mermaidStyles, /\b(?:background|border|padding):/)
})

test("zooms images and Mermaid with medium-zoom", (context) => {
  const createImage = (alt = "") => ({
    alt, tabIndex: -1, src: "", className: "",
    setAttribute: context.mock.fn(),
    addEventListener: context.mock.fn(),
  })
  const visuals = [createImage("Release photo"), createImage()]
  const diagram = createImage()
  const svg = {
    outerHTML: '<svg xmlns="http://www.w3.org/2000/svg"><text>Résumé &amp; "release"</text></svg>',
    replaceWith: context.mock.fn((image: typeof diagram) => visuals.push(image)),
  }
  const open = context.mock.fn()
  const mediumZoom = context.mock.fn((targets: unknown[]) => {
    assert.deepEqual(Array.from(targets), visuals)
    return { open }
  })

  runInNewContext(zoomScript, {
    document: {
      querySelectorAll(selector: string) {
        if (selector === ".mermaid svg") return [svg]
        assert.equal(selector, ".typeset img:not(a img)")
        return visuals
      },
      createElement(tag: string) {
        assert.equal(tag, "img")
        return diagram
      },
    },
    window: { mediumZoom },
  })

  assert.equal(svg.replaceWith.mock.callCount(), 1)
  assert.equal(svg.replaceWith.mock.calls[0].arguments[0], diagram)
  assert.equal(diagram.alt, "Mermaid diagram")
  assert.equal(diagram.className, "mermaid-image")
  assert.equal(diagram.src, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`)
  assert.equal(mediumZoom.mock.callCount(), 1)

  for (const visual of visuals) {
    assert.equal(visual.tabIndex, 0)
    assert.deepEqual(Object.fromEntries(visual.setAttribute.mock.calls.map(call => call.arguments)), {
      role: "button",
      "aria-label": visual.alt ? `Zoom ${visual.alt}` : "Zoom image",
    })
    assert.equal(visual.addEventListener.mock.callCount(), 1)
    const [eventName, keydown] = visual.addEventListener.mock.calls[0].arguments
    assert.equal(eventName, "keydown")

    for (const key of ["Enter", " ", "Escape"]) {
      open.mock.resetCalls()
      const preventDefault = context.mock.fn()
      keydown({ key, preventDefault })
      const expectedCalls = key === "Escape" ? 0 : 1
      assert.equal(preventDefault.mock.callCount(), expectedCalls)
      assert.equal(open.mock.callCount(), expectedCalls)
      if (expectedCalls) assert.equal(open.mock.calls[0].arguments[0].target, visual)
    }
  }
})

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
  assert.match(html, /<script src="\/vendor\/medium-zoom\/medium-zoom\.min\.js" defer><\/script>/)
  assert.match(html, /<script src="\/document-zoom\.js" defer><\/script>/)
  assert.ok(html.indexOf("/vendor/medium-zoom/medium-zoom.min.js") < html.indexOf("/document-zoom.js"))
  assert.doesNotMatch(html, /<dialog class="visual-zoom"/)
  assert.match(html, /<article class="typeset typeset-compact">/)
  assert.match(html, /Built with drop\.vitehub\.dev/)
  assert.doesNotMatch(html, /class="site-header"/)
  assert.doesNotMatch(html, /fonts\.googleapis\.com/)
})

test("does not execute raw HTML or allow arbitrary attributes", async () => {
  const html = await renderMarkdownDocument("---\ntitle: Safe </title><script>\n---\n\n# Safe\n\n<script>alert('no')</script>\n\n[bad](javascript:alert(1)) [good](https://example.com){style=\"position:fixed\" onclick=\"alert(1)\"}", pathname)

  assert.doesNotMatch(html, /<script>/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.doesNotMatch(html, /<a\b[^>]*(?:style=|onclick=)/)
  assert.match(html, /&lt;script&gt;alert\('no'\)&lt;\/script&gt;/)
  assert.match(html, /href="https:\/\/example\.com"/)
})

test("escapes invalid Mermaid source", async () => {
  const html = await renderMarkdownDocument("```mermaid\n<script>alert('no')</script>\n```", pathname)

  assert.match(html, /class="mermaid-error"/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test("bounds Mermaid rendering work", async () => {
  const diagrams = Array.from({ length: 5 }, (_, index) => `\`\`\`mermaid\ngraph LR\n  A${index} --> B${index}\n\`\`\``).join("\n\n")
  const html = await renderMarkdownDocument(diagrams, pathname)

  assert.equal(html.match(/<div class="mermaid">/g)?.length, 4)
  assert.match(html, /class="mermaid-error"/)

  const oversized = await renderMarkdownDocument(`\`\`\`mermaid\n${"A --> B\n".repeat(1_001)}\`\`\``, pathname)
  assert.doesNotMatch(oversized, /<div class="mermaid">/)
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
