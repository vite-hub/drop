import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const source = `# Launch reactions

::post{url="https://x.com/miraokafor/status/1856000000000000000" author="Mira Okafor" handle="miraokafor" avatar="/avatar.png" time="2026-11-20T09:30:00Z" replies="48" reposts="312" likes="2.4K"}
The new parser shipped today, and our docs build went from 41s to 9s. Thanks @tlin for the review #buildtools

![The build dashboard](/wide.png) ![The build log](/tall.png)
::
`

// Vitest empties CSS imports, including ?raw, so the frame gets the document's actual styles here.
const styles = (
  await Promise.all(
    ["../../shared/typeset.css", "../../shared/document-shell.css"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  )
).join("\n")

// A 1200×300 and a 300×1200 picture, so a stretched or squashed image shows in its box's ratio.
const svg = (width, height) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#888"/></svg>`
const pictures = { "/avatar.png": svg(400, 400), "/wide.png": svg(1200, 300), "/tall.png": svg(300, 1200) }

test(
  "a ::post renders through Drop's allowlist as the card, and the doc's image rules leave its avatar and media alone",
  { timeout: 30000 },
  async () => {
    const { html } = await renderMarkdownCached("social-post.md", async () => source)
    assert.match(html, /class="csl[" ]/)
    assert.match(html, /class="csl-avatar"/)
    assert.match(html, /class="csl-media"/)
    assert.match(html, /class="csl-counts"/)
    assert.doesNotMatch(html, /unsupported-component|render-error/)

    const escaped = planDocument("markdown", source, false, html)
      .replace("</head>", `<style>${styles}</style></head>`)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === "drop.test" && pictures[url.pathname])
          return route.fulfill({ contentType: "image/svg+xml", body: pictures[url.pathname] })
        if (url.hostname !== "drop.test" || url.pathname !== "/") return route.abort()
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style>
          <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>`,
        })
      })
      await page.goto("https://drop.test/")
      const frame = page.frames()[1]
      await frame.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth))
      const boxes = await frame.evaluate(() => {
        const box = (element) => {
          const { width, height } = element.getBoundingClientRect()
          return { width, height, fit: getComputedStyle(element).objectFit }
        }
        return {
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
          avatar: box(document.querySelector("img.csl-avatar")),
          // Two pictures sit side by side in the grid's two columns, each the grid's full height.
          media: [...document.querySelectorAll(".csl-media img")].map((image) => {
            const grid = image.parentElement
            const gap = parseFloat(getComputedStyle(grid).columnGap)
            return { ...box(image), cell: { width: (grid.clientWidth - gap) / 2, height: grid.clientHeight } }
          }),
        }
      })
      // comark-social draws the avatar 2.5rem square; Drop's frame sets its own root size.
      assert.deepEqual(boxes.avatar, { width: 2.5 * boxes.rem, height: 2.5 * boxes.rem, fit: "cover" })
      assert.equal(boxes.media.length, 2)
      for (const image of boxes.media) {
        assert.equal(image.fit, "cover", "a picture fills its cell, cropped, never stretched")
        assert.ok(Math.abs(image.width - image.cell.width) < 1, JSON.stringify(image))
        assert.ok(Math.abs(image.height - image.cell.height) < 1, JSON.stringify(image))
      }
    } finally {
      await browser.close()
    }
  },
)
