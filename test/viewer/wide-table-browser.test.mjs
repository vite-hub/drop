import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

// A review doc's table of pull requests: short ids and links beside two prose columns, under two headings so the
// outline shows.
const source = `# Open PRs

Seven need you.

## 1. Needs you

| PR | Summary | Status / your next step | Links |
|---|---|---|---|
| [portal #1596](https://github.com/acme/portal/pull/1596) | Each user keeps their own column layout in every table | Christopher requested changes: show when the layout differs from the default and add a reset button. Main was merged in at 10:08, so it has no conflicts now. | [preview](https://example.com) [drop](https://example.com/d) |
| [portal #1610](https://github.com/acme/portal/pull/1610) | Alert details describe demand line outliers: the quantity against the SKU's average per demand line, instead of "Alert details are unavailable." | Preview deployed, e2e running, no reviewer. Check the before/after, then request Christopher. | [preview](https://example.com) |
| [website #33](https://github.com/acme/website/pull/33) | Planning guides and a Netstock comparison | Green, no reviewer. Request Christopher. | |

## 2. Needs product input

Three wait on Morten.
`

// Vitest empties CSS imports, including ?raw, so the frame gets the document's actual styles here.
const styles = (
  await Promise.all(
    ["../../shared/typeset.css", "../../shared/document-shell.css"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  )
).join("\n")

// The doc in the viewer's frame, filling a window of the given width.
async function open(browser, width) {
  const { html } = await renderMarkdownCached("wide-table.md", async () => source)
  const escaped = planDocument("markdown", source, false, html)
    .replace("</head>", `<style>${styles}</style></head>`)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width, height: 1000 } })
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
    const box = (node) => node.getBoundingClientRect()
    const outline = document.querySelector(".cto-rail")
    return {
      text: box(document.querySelector(".typeset > p")),
      table: box(document.querySelector(".typeset > [data-wide]:has(> table)")),
      outline: outline?.getClientRects().length ? box(outline) : null,
      outlineLinks: [...(outline?.querySelectorAll("a[href^='#']") ?? [])].filter(
        (link) => link.getClientRects().length,
      ).length,
      chips: [...document.querySelectorAll(".typeset [data-short] .cp")].map((chip) => chip.getClientRects().length),
      // comark-ui lays a table with prose out as a grid, so it counts as stacked when a row's cells stop sharing a line.
      stacked:
        new Set([...document.querySelectorAll(".typeset tbody > tr:first-child > td")].map((cell) => box(cell).top))
          .size > 1,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

test(
  "a wide table grows into the room left of the text and keeps clear of the outline",
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const shown = await open(browser, 1600)
      assert.ok(
        shown.table.left < shown.text.left - 100,
        `table starts at ${shown.table.left}, text at ${shown.text.left}`,
      )
      assert.ok(shown.table.width > shown.text.width + 200)
      assert.ok(shown.outline, "the outline shows")
      assert.ok(
        shown.outline.left >= shown.table.right,
        `outline at ${shown.outline.left}, table ends at ${shown.table.right}`,
      )
      assert.equal(shown.stacked, false)
      // "portal #1596" and each link chip stay on one line.
      assert.deepEqual(new Set(shown.chips), new Set([1]))
      assert.equal(shown.overflow, 0)

      // Narrower, the table still takes its own width on both sides of the text rather than stacking.
      const laptop = await open(browser, 1480)
      assert.ok(laptop.table.left < laptop.text.left - 100 && laptop.table.right > laptop.text.right + 100)
      assert.ok(laptop.outlineLinks >= 2, "the section links are visible when the rail cannot fit")
      assert.ok(laptop.outline.left >= laptop.table.right || laptop.outline.top >= laptop.table.bottom)
      assert.equal(laptop.stacked, false)
      assert.equal(laptop.overflow, 0)

      const phone = await open(browser, 390)
      assert.equal(phone.stacked, true)
      assert.equal(phone.overflow, 0)
    } finally {
      await browser.close()
    }
  },
)
