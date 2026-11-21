import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, firefox } from "playwright"
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

const metrics = `| Summary | Status | Average response time (milliseconds) | Successful requests per second | Peak memory usage (megabytes) | Average disk throughput (megabytes) |
| --- | --- | --- | --- | --- | --- |
| The deployment finished and handled the expected number of requests. | The metrics were collected and are ready for review. | 123 | 456 | 789 | 912 |
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
async function openFrame(browser, width, key, markdown) {
  const { html } = await renderMarkdownCached(key, async () => markdown)
  const escaped = planDocument("markdown", markdown, false, html)
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
  return page.frames()[1]
}

async function open(browser, width, key = "wide-table.md", markdown = source) {
  const frame = await openFrame(browser, width, key, markdown)
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

      const longHeading = source.replace("2. Needs product input", "VeryLongGeneratedWorkflowIdentifier".repeat(6))
      const wrapped = await open(browser, 1480, "wide-table-long-heading.md", longHeading)
      assert.ok(wrapped.outlineLinks >= 2)
      assert.equal(wrapped.overflow, 0)

      const phone = await open(browser, 390)
      assert.equal(phone.stacked, true)
      assert.equal(phone.overflow, 0)
    } finally {
      await browser.close()
    }
  },
)

test.each([
  { name: "Chromium", browserType: chromium },
  { name: "Firefox", browserType: firefox },
])("folded prose stays readable at 630px in $name", { timeout: 30000 }, async ({ browserType }) => {
  const browser = await browserType.launch()
  try {
    const frame = await openFrame(browser, 630, "folded-metrics.md", metrics)
    const cells = await frame.locator("tbody > tr > td").evaluateAll((nodes) =>
      nodes.map((node) => {
        const { left, right, top, width } = node.getBoundingClientRect()
        return { left, right, top, width }
      }),
    )
    const [summary, status, numeric] = cells
    assert.ok(status.top > summary.top, "the prose is folded")
    assert.ok(summary.width >= 140 && status.width >= 140, "folded prose has room for several words per line")
    assert.ok(summary.right <= numeric.left && status.right <= numeric.left, "prose stays within its track")
    const overflow = await frame.locator("html").evaluate((root) => root.scrollWidth - root.clientWidth)
    assert.equal(overflow, 0, "the page does not scroll horizontally")
  } finally {
    await browser.close()
  }
})

test("printing a folded table to A5 preserves the last column", { timeout: 30000 }, async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const { html } = await renderMarkdownCached("print-metrics.md", async () => metrics)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route("**/*", (route) => route.abort())
    await page.setContent(
      planDocument("markdown", metrics, false, html).replace("</head>", `<style>${styles}</style></head>`),
    )
    const bytes = await page.pdf({ format: "A5" })
    const loading = getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await loading.promise
      const content = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => (await pdf.getPage(index + 1)).getTextContent()),
      )
      const text = content.flatMap(({ items }) => items.map((item) => item.str ?? "")).join(" ")
      assert.match(text, /Average\s+disk\s+throughput\s+\(megabytes\)/)
      assert.match(text, /\b912\b/)
    } finally {
      await loading.destroy()
    }
  } finally {
    await browser.close()
  }
})

test("a dense ID table keeps visible headings and scrolls on phones", { timeout: 30000 }, async () => {
  const markdown = `| Task ID | Trace ID | Started | Finished | Status |
| --- | --- | --- | --- | --- |
| 01ARBZ3NDEKTSV4RRFFQ69G5F1 | 01ARBZ3NDEKTSV4RRFFQ69G5F2 | 2026-11-18T19:00:00Z | 2026-11-18T19:01:00Z | Done |
`
  const browser = await chromium.launch()
  try {
    const frame = await openFrame(browser, 390, "task-traces.md", markdown)
    const layout = await frame.locator("[data-wide]:has(> table)").evaluate((wrapper) => {
      const header = wrapper.querySelector("thead > tr")
      return {
        clipped: getComputedStyle(header).clipPath !== "none",
        headerHeight: header.getBoundingClientRect().height,
        tableOverflow: wrapper.scrollWidth - wrapper.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.equal(layout.clipped, false)
    assert.ok(layout.headerHeight > 1)
    assert.ok(layout.tableOverflow > 0)
    assert.equal(layout.pageOverflow, 0)
  } finally {
    await browser.close()
  }
})

test("zooming an annotated stacked chart preserves the bar clip paths", { timeout: 30000 }, async () => {
  const markdown = `::chart{type="stacked" horizontal}
| week | ale | wine |
| --- | --: | --: |
| 1 | 4 | 2 |
| 2 | 6 | 1 |

:::annotation{at="2" mark="circle"}
The fleet came in.
:::
::
`
  const browser = await chromium.launch()
  try {
    const frame = await openFrame(browser, 1000, "stacked-chart.md", markdown)
    await frame.locator("[data-zoom]:has(svg clipPath)").first().click()
    const chart = frame.locator(".cz-dialog[open] svg:has(clipPath)").first()
    await chart.waitFor()
    const clips = await chart.evaluate((svg) => {
      const ids = new Set([...svg.querySelectorAll("clipPath[id]")].map((clip) => clip.id))
      return [...svg.querySelectorAll("[clip-path]")].map((node) => {
        const id = /^url\(#(.+)\)$/.exec(node.getAttribute("clip-path"))?.[1]
        return ids.has(id) && document.getElementById(id)?.closest("svg") === svg
      })
    })
    assert.ok(clips.length > 0 && clips.every(Boolean), "zoomed bars reference clip paths in the zoomed chart")
  } finally {
    await browser.close()
  }
})
