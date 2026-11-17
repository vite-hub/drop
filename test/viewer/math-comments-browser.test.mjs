import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const markdown = `# Capital accumulation

In the Solow model, output is $Y = A K^\\alpha L^{1-\\alpha}$ with $\\alpha \\in (0, 1)$.

$$
\\frac{\\dot{k}}{k} = s A k^{\\alpha - 1} - (n + \\delta)
$$

so it settles where saving covers depreciation.
`
const { html } = await renderMarkdownCached("math-comments", async () => markdown)
// Vitest reads CSS `?raw` imports as empty strings, so the frame gets the real stylesheets the way the app builds them.
const css = (name) => readFile(new URL(`../../shared/${name}`, import.meta.url), "utf8")
const [typeset, shell, theme] = await Promise.all(["typeset.css", "document-shell.css", "theme.css"].map(css))
const FONTS =
  '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");'

const comment = (id, quote) => ({
  id,
  n: Number(id.slice(1)),
  kind: "text",
  selector: "body",
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  quote,
  label: "p",
  resolved: false,
  earlier: false,
  author: "Sara Lindqvist",
  image: null,
  body: "About it.",
  replies: 0,
})

async function open(browser, markers) {
  const document = planDocument("markdown", "", false, html).replace(FONTS, `${typeset}${shell}</style><style>${theme}`)
  const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
            <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => {
              if (!e.data?.__drop) return;
              window.posts.push(e.data);
              if (e.data.type === "ready") e.source.postMessage({ __drop: true, type: "markers", markers: ${JSON.stringify(markers)} }, "*");
            });</script>`,
        })
      : route.abort(),
  )
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"), null, { timeout: 8000 })
  return { context, page, frame: page.frames()[1] }
}

test("comments quote, anchor, and mark text around and inside math, and leave the MathML whole", async () => {
  const browser = await chromium.launch()
  try {
    // What the frame quotes when a reader selects into the inline formula, and across the display formula.
    const probe = await open(browser, [])
    const quotes = await probe.frame.evaluate(() => {
      const select = (range) => {
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        return getSelection().toString().trim().replace(/\s+/g, " ")
      }
      const p = document.querySelector("main p")
      const words = [...p.childNodes].find((node) => node.nodeType === 3 && node.data.includes("output is"))
      const into = document.createRange()
      into.setStart(words, words.data.indexOf("output is"))
      into.setEnd(p.querySelector("math mi").firstChild, 1)
      const display = document.createRange()
      display.selectNodeContents(document.querySelector("math[display=block]"))
      return { into: select(into), display: select(display) }
    })
    await probe.context.close()
    assert.match(quotes.into, /^output is \S+$/)
    assert.ok(quotes.display.length > 10, quotes.display)

    const { context, frame } = await open(browser, [
      comment("c1", "In the Solow model, output is"),
      comment("c2", quotes.into),
      comment("c3", quotes.display),
    ])
    await frame.waitForFunction(() => document.querySelectorAll("drop-bubble").length === 3, null, { timeout: 8000 })
    const drawn = await frame.evaluate(() => ({
      marked: CSS.highlights.get("drop-margin")?.size ?? 0,
      // MathML holds no HTML: a bubble at a quote's end inside a formula goes right after its <math>.
      inMath: document.querySelectorAll("math drop-bubble").length,
      display: (() => {
        const bubble = document.querySelector('drop-bubble[data-id="c3"]')
        const math = document.querySelector("math[display=block]").getBoundingClientRect()
        const box = bubble.getBoundingClientRect()
        return {
          beside: box.left >= math.right - 1 && box.top < math.bottom,
          height: box.height,
          mathHeight: math.height,
        }
      })(),
    }))
    assert.equal(drawn.marked, 3)
    assert.equal(drawn.inMath, 0)
    assert.ok(drawn.display.beside, JSON.stringify(drawn.display))
    assert.ok(drawn.display.height < drawn.display.mathHeight, JSON.stringify(drawn.display))
    await context.close()
  } finally {
    await browser.close()
  }
}, 30_000)
