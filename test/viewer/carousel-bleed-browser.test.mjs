import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

// A trip plan: a photo carousel between sections, so the outline shows beside the text.
const paragraph =
  "Each cabin sleeps four, with a wood stove, a sauna by the lake, and a short walk to the village. ".repeat(3)
const slides = ["Lakeside", "Forest edge", "Hilltop", "Meadow", "Old mill", "Birch grove"]
  .map((name) => `**${name}** · four beds, a wood stove and a sauna.`)
  .join("\n\n")
const source = [
  "# Cabin shortlist",
  `## Photos\n\n${paragraph}`,
  `::carousel{title="Cabins" columns=3}\n${slides}\n::`,
  `## Prices\n\n${paragraph}\n\n${paragraph}`,
  `## Getting there\n\n${paragraph}`,
].join("\n\n")

// Vitest empties CSS imports, including ?raw, so the frame gets the document's actual styles here.
const styles = (
  await Promise.all(
    ["../../shared/typeset.css", "../../shared/document-shell.css"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  )
).join("\n")

async function open(browser, width) {
  const { html } = await renderMarkdownCached("carousel-bleed.md", async () => source)
  const escaped = planDocument("markdown", source, false, html)
    .replace("</head>", `<style>${styles}</style></head>`)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test" || url.pathname !== "/") return route.abort()
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style>
        <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });</script>`,
    })
  })
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  await frame.waitForFunction(() => window.__comarkOutline, null, { polling: 100 })
  await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return frame.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect()
    const outline = document.querySelector(".cto-rail")
    return {
      text: box(".typeset > p"),
      track: box(".cc-track"),
      controls: box(".cc-controls"),
      slide: box(".cc-slide"),
      carousel: box(".typeset > .cc"),
      outline: outline?.getClientRects().length ? outline.getBoundingClientRect() : null,
      viewport: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

test(
  "a carousel's slides run past the text into the room on its right, clear of the outline",
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const desktop = await open(browser, 1440)
      assert.equal(Math.round(desktop.track.left), Math.round(desktop.text.left))
      assert.ok(desktop.track.right > desktop.text.right + 40, JSON.stringify(desktop))
      // Three slides still fill the column; the fourth is the one that peeks in.
      assert.ok(Math.abs(desktop.slide.width * 3 - (desktop.carousel.width - 2 * 16)) < 4)
      assert.ok(Math.abs(desktop.controls.right - desktop.text.right) < 2, "the counter and arrows stay under the text")
      assert.ok(desktop.outline, "the outline shows")
      assert.ok(
        desktop.outline.left >= desktop.track.right + 24,
        `outline at ${desktop.outline.left}, slides end at ${desktop.track.right}`,
      )
      assert.equal(desktop.overflow, 0)

      const phone = await open(browser, 390)
      assert.ok(phone.track.right <= phone.viewport, `track ends at ${phone.track.right} in ${phone.viewport}`)
      assert.equal(phone.overflow, 0)
    } finally {
      await browser.close()
    }
  },
)
