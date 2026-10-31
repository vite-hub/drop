import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// Vitest reads CSS `?raw` imports as empty strings, so the frame gets the real stylesheets the way the app builds them.
const css = (name) => readFile(new URL(`../../shared/${name}`, import.meta.url), "utf8")
const [typeset, shell, theme] = await Promise.all(["typeset.css", "document-shell.css", "theme.css"].map(css))

const html = `<h1>Plan</h1>
<p>The deploy waits when more than twelve pigeons sit on the roof. Count them after the stand-up, from the east window.</p>`
const text = (id, quote, extra) => ({
  id,
  n: Number(id.slice(1)),
  kind: "text",
  selector: "main > article > p",
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  quote,
  label: "p",
  resolved: false,
  earlier: false,
  author: "Ada",
  image: null,
  body: "",
  replies: 0,
  suggestion: null,
  ...extra,
})
const markers = [
  text("c1", "twelve", { suggestion: "fifteen" }),
  text("c2", "after the stand-up", { suggestion: "" }),
  text("c3", "east window", { body: "Not the west one." }),
]

test("a suggestion strikes its quote and shows the new words after it, and the page's text stays its own", async () => {
  const browser = await chromium.launch()
  try {
    const document = planDocument("markdown", "", false, html).replace("<style>", `<style>${typeset}${shell}${theme}`)
    const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "drop.test"
        ? route.fulfill({
            contentType: "text/html",
            body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
              <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
              <script>addEventListener("message", (e) => {
                if (e.data?.__drop && e.data.type === "ready") window.send = (markers) => e.source.postMessage({ __drop: true, type: "markers", markers }, "*");
              });</script>`,
          })
        : route.abort(),
    )
    const page = await context.newPage()
    await page.goto("https://drop.test/")
    await page.waitForFunction(() => window.send)
    const frame = page.frames()[1]
    const before = await frame.evaluate(() => document.querySelector("main > article > p").textContent)
    const send = async (list) => {
      await page.evaluate((list) => window.send(list), list)
      await frame.waitForFunction(
        (n) => document.querySelectorAll("drop-ins").length === n,
        list.filter((m) => m.suggestion).length,
      )
    }

    // Sent twice, as every new comment does: the redline is drawn once.
    await send(markers)
    await send(markers)
    const drawn = await frame.evaluate(() => {
      const ins = document.querySelector("drop-ins")
      const style = getComputedStyle(ins)
      return {
        inserts: [...document.querySelectorAll("drop-ins")].map((el) => el.dataset.text),
        before: ins.previousSibling.data.slice(-6),
        after: ins.nextElementSibling?.localName,
        shown: getComputedStyle(ins, "::after").content,
        tinted: style.backgroundColor !== "rgba(0, 0, 0, 0)",
        struck: CSS.highlights.get("drop-del")?.size,
        margin: CSS.highlights.get("drop-margin")?.size,
        text: document.querySelector("main > article > p").textContent,
      }
    })
    assert.deepEqual(drawn.inserts, ["fifteen"], "a deletion adds no words")
    assert.equal(drawn.before, "twelve")
    assert.equal(drawn.after, "drop-bubble", "the new words sit between the quote and its bubble")
    assert.equal(drawn.shown, '"fifteen"')
    assert.ok(drawn.tinted)
    assert.equal(drawn.struck, 2, "both suggestions strike their quotes")
    assert.equal(drawn.margin, 1, "the plain comment keeps its anchor highlight")
    assert.equal(drawn.text, before, "the new words are generated, so quotes are still found in the page's own text")

    await send([])
    assert.equal(
      await frame.evaluate(() => document.querySelector("main > article > p").childNodes.length),
      1,
      "taking the redline out leaves the paragraph one text node again",
    )
    await context.close()
  } finally {
    await browser.close()
  }
})
