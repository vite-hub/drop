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
  `::carousel{title="Lakeside" columns=3}\n${["Deck", "Sauna", "Kitchen", "Loft"].map((name) => `![${name}](/${name}.png)`).join("\n\n")}\n::`,
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

// A 1×1 PNG, so the photo slides load something.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

async function open(browser, width, height = 900) {
  const { html } = await renderMarkdownCached("carousel-bleed.md", async () => source)
  const escaped = planDocument("markdown", source, false, html)
    .replace("</head>", `<style>${styles}</style></head>`)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width, height } })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "drop.test" && url.pathname.endsWith(".png"))
      return route.fulfill({ contentType: "image/png", body: pixel })
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
      photo: (() => {
        const slide = document.querySelector(".cc-slide:has(> img)")
        const img = slide.querySelector("img").getBoundingClientRect()
        const { backgroundColor, paddingTop } = getComputedStyle(slide)
        return {
          slide: slide.getBoundingClientRect().width,
          width: img.width,
          height: img.height,
          backgroundColor,
          paddingTop,
        }
      })(),
      viewport: document.documentElement.clientWidth,
      frame: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

test(
  "a carousel's slides run past the text to the frame's edge, or stop clear of the outline",
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
      // A slide that is one photo is the photo itself: no panel around it, filling the slide at 4:3.
      assert.equal(desktop.photo.backgroundColor, "rgba(0, 0, 0, 0)")
      assert.equal(desktop.photo.paddingTop, "0px")
      assert.ok(Math.abs(desktop.photo.width - desktop.photo.slide) < 1, JSON.stringify(desktop.photo))
      assert.ok(Math.abs(desktop.photo.height - (desktop.photo.width * 3) / 4) < 1, JSON.stringify(desktop.photo))

      // A frame beside the viewer's panel, too narrow for the outline's column, and short enough to scroll, so the
      // slides run under its classic scrollbar without the page scrolling sideways. Playwright hides
      // scrollbars in headless Chromium, so this browser keeps them.
      const scrollbars = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] })
      const narrow = await open(scrollbars, 974, 500).finally(() => scrollbars.close())
      assert.equal(narrow.outline, null)
      assert.ok(narrow.viewport < narrow.frame, "the frame scrolls, so its scrollbar takes room")
      assert.ok(narrow.track.right > narrow.viewport, `slides end at ${narrow.track.right}, short of the scrollbar`)
      assert.equal(narrow.overflow, 0)

      const phone = await open(browser, 390)
      assert.equal(Math.round(phone.track.right), phone.frame, "the slides run to the screen's edge")
      assert.equal(phone.overflow, 0)
    } finally {
      await browser.close()
    }
  },
)
