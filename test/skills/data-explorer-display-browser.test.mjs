// A data-explorer page draws what its data says, whatever order the rows come in: a line is named at its last point, a
// short monthly chart prints each month once, a negative amount keeps its minus with its figure, a text column's header
// sits over its text, and a table's button says how many rows it shows next.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { afterAll, test } from "vite-plus/test"

const skill = fileURLToPath(new URL("../../skills/data-explorer/", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "data-explorer-display-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Vega comes with comark-ui's charts; the page asks jsDelivr for it, and the test answers from these files.
const charts = createRequire(createRequire(import.meta.url).resolve("comark-ui/package.json"))
const from = createRequire(charts.resolve("comark-charts/package.json"))
const vega = {
  "vega@6": join(dirname(from.resolve("vega")), "vega.min.js"),
  "vega-lite@6": join(dirname(from.resolve("vega-lite")), "vega-lite.min.js"),
}

const months = ["2026-01", "2026-02", "2026-03"]
const names = Array.from({ length: 15 }, (_, i) => ({ name: `Repository ${i + 1}`, stars: 100 - i }))
const report = {
  title: "Display cases",
  subtitle: "Test data",
  filters: [{ field: "team", type: "list", label: "Teams", count: "byMonth" }],
  data: {
    totals: [{ balance: -1234 }],
    // Newest month first, so each team's last row is its first point.
    byMonth: months.toReversed().flatMap((month, i) => [
      { month, team: "Alpha", count: 30 - i },
      { month, team: "Beta", count: 10 + i },
    ]),
    repos: names,
  },
  top: [{ type: "stats", items: [{ label: "balance", value: { data: "totals", field: "balance" }, format: "money" }] }],
  views: [
    {
      id: "overview",
      label: "Overview",
      blocks: [
        { type: "chart", chart: "line", title: "Per month", data: "byMonth", x: "month", y: "count", series: "team" },
        {
          type: "table",
          title: "All at once",
          data: "repos",
          columns: [
            { field: "name", label: "Name" },
            { field: "stars", label: "Stars" },
          ],
        },
        {
          type: "table",
          title: "Five at a time",
          data: "repos",
          columns: [{ field: "name", label: "Name" }],
          limit: 5,
          more: 5,
        },
      ],
    },
  ],
}

test("line names, month ticks, a negative amount, headers and the table button read right", async () => {
  writeFileSync(join(dir, "report.json"), JSON.stringify(report))
  execFileSync("node", [join(skill, "scripts/build.mjs"), "report.json", "report.html"], { cwd: dir })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1400 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.route("https://cdn.jsdelivr.net/npm/**", (route) => {
      const name = Object.keys(vega).find((key) => route.request().url().includes(`/npm/${key}/`))
      return name ? route.fulfill({ contentType: "text/javascript", body: readFileSync(vega[name]) }) : route.abort()
    })
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort())
    await page.goto(`file://${join(dir, "report.html")}#overview`)
    await page.waitForFunction(() => document.querySelector('.rp-chart[data-state="ok"] svg'))
    const block = (title) => page.locator("section.rp-block").filter({ has: page.locator("h3", { hasText: title }) })

    // Each line's name sits at its last month, on the right, not at the first row of the data.
    const chart = block("Per month").locator("svg").first()
    const box = await chart.boundingBox()
    for (const team of ["Alpha", "Beta"]) {
      const label = await chart.locator(".role-mark text", { hasText: new RegExp(`^${team}$`) }).boundingBox()
      assert.ok(
        label.x > box.x + box.width * 0.6,
        `${team} is named at x ${label.x} in a chart from ${box.x} to ${box.x + box.width}`,
      )
    }

    // Three months print three labels, one per month.
    const ticks = await chart.locator('[aria-label^="X-axis"] .role-axis-label text').allTextContents()
    assert.deepEqual(ticks, ["Jan 2026", "Feb 2026", "Mar 2026"])

    // The minus stays with the figure; only the "$" prints small.
    const stat = page.locator(".rp-stat-value").first()
    assert.equal(await stat.textContent(), "-$1,234")
    assert.deepEqual(await stat.locator("small").allTextContents(), ["$"])

    // A text column's header is left-aligned over its text; a number column's is right-aligned over its numbers.
    const headers = block("All at once").locator("th")
    const align = (th) => th.evaluate((el) => getComputedStyle(el).textAlign)
    assert.match(await align(headers.filter({ hasText: "Name" })), /^(left|start)$/)
    assert.match(await align(headers.filter({ hasText: "Stars" })), /^(right|end)$/)

    // 12 of 15 rows show; the next step shows the rest, so the button says all.
    assert.equal(await block("All at once").locator(".rp-more").textContent(), "Show all 15")
    const more = block("Five at a time").locator(".rp-more")
    assert.equal(await more.textContent(), "Show 5 more")
    await more.click()
    assert.equal(await more.textContent(), "Show all 15")
    await more.click()
    assert.equal(await more.count(), 0)
    assert.equal(await block("Five at a time").locator("tbody tr").count(), 15)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 60_000)
