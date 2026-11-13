// A data-explorer page filters on a click anywhere a list filter's value is drawn: a bar, a legend entry, a category's
// axis label, a line under the pointer, a line's name and a matrix cell. Each click shows in the URL's hash, and the
// block clicked keeps every value and fades the others.
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
const dir = mkdtempSync(join(tmpdir(), "data-explorer-clicks-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Vega comes with comark-ui's charts; the page asks jsDelivr for it, and the test answers from these files.
const charts = createRequire(createRequire(import.meta.url).resolve("comark-ui/package.json"))
const from = createRequire(charts.resolve("comark-charts/package.json"))
const vega = {
  "vega@6": join(dirname(from.resolve("vega")), "vega.min.js"),
  "vega-lite@6": join(dirname(from.resolve("vega-lite")), "vega-lite.min.js"),
}

const months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]
const teams = { Alpha: 30, Beta: 18, Gamma: 6 }
const report = {
  title: "Issue tracker",
  subtitle: "Test data",
  filters: [
    { field: "team", label: "Teams", count: "byTeamType" },
    { field: "type", label: "Types", count: "byTeamType" },
  ],
  data: {
    byTeamType: Object.entries(teams).flatMap(([team, n]) =>
      ["Bug", "Feature"].map((type, i) => ({ team, type, count: n + i * 4 })),
    ),
    byMonth: months.flatMap((date, i) => Object.entries(teams).map(([team, n]) => ({ date, team, count: n + i }))),
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      blocks: [
        {
          type: "chart",
          chart: "stacked",
          title: "By team and type",
          data: "byTeamType",
          x: "team",
          y: "count",
          series: "type",
        },
        { type: "chart", chart: "line", title: "Per month", data: "byMonth", x: "date", y: "count", series: "team" },
        { type: "matrix", title: "Team by type", data: "byTeamType", x: "type", y: "team", value: "count" },
      ],
    },
  ],
}

test("a click on a chart, a legend, an axis label or a matrix cell filters the page", async () => {
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
    const url = `file://${join(dir, "report.html")}`
    const chart = (title) =>
      page
        .locator("section.rp-block")
        .filter({ has: page.locator("h3", { hasText: title }) })
        .locator("svg")
        .first()
    const after = async (click) => {
      await page.goto(`${url}#overview`)
      await page.waitForFunction(() => document.querySelectorAll('.rp-chart[data-state="ok"] svg').length === 2)
      await click()
      await page.waitForFunction(() => location.hash.includes("?"))
      return new URLSearchParams(decodeURIComponent(await page.evaluate(() => location.hash)).split("?")[1])
    }

    const opacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity))

    let hash = await after(() => chart("By team and type").locator('path[aria-label*="type: Feature"]').first().click())
    assert.equal(hash.get("type"), "Feature")
    await page.waitForFunction(() => document.querySelectorAll('.rp-chart[data-state="ok"] svg').length === 2)
    const bars = chart("By team and type")
    assert.equal(await bars.locator('.role-mark path[aria-label*="type: Bug"]').count(), 3)
    assert.equal(await opacity(bars.locator('.role-mark path[aria-label*="type: Bug"]').first()), 0.2)
    assert.equal(await opacity(bars.locator('.role-mark path[aria-label*="type: Feature"]').first()), 1)
    assert.equal(await opacity(bars.locator(".role-legend-label text", { hasText: "Bug" })), 0.2)
    hash = await after(() => chart("By team and type").locator(".role-legend-label text", { hasText: "Bug" }).click())
    assert.equal(hash.get("type"), "Bug")
    hash = await after(() => chart("By team and type").locator(".role-axis-label text", { hasText: "Gamma" }).click())
    assert.equal(hash.get("team"), "Gamma")
    await page.waitForFunction(() => document.querySelectorAll('.rp-chart[data-state="ok"] svg').length === 2)
    const label = (name) =>
      chart("By team and type")
        .locator(".role-axis-label text", { hasText: name })
        .evaluate((el) => Number(getComputedStyle(el).fillOpacity))
    assert.deepEqual([await label("Alpha"), await label("Gamma")], [0.2, 1])
    hash = await after(() =>
      chart("Per month")
        .locator(".role-mark text", { hasText: /^Beta$/ })
        .click(),
    )
    assert.equal(hash.get("team"), "Beta")
    await page.waitForFunction(() => document.querySelectorAll('.rp-chart[data-state="ok"] svg').length === 2)
    assert.equal(await opacity(chart("Per month").locator(".role-mark text", { hasText: /^Alpha$/ })), 0.2)
    assert.equal(await opacity(chart("Per month").locator(".role-mark text", { hasText: /^Beta$/ })), 1)
    // Away from any point, the hover layer takes the click, and the line nearest the pointer wins.
    hash = await after(async () => {
      const point = await chart("Per month").locator('.role-mark path[aria-label*="team: Alpha"]').nth(1).boundingBox()
      await page.mouse.click(point.x + point.width / 2 + 12, point.y + point.height / 2 + 4)
    })
    assert.equal(hash.get("team"), "Alpha")
    hash = await after(() => page.locator(".rp-matrix td.is-click").last().click())
    assert.deepEqual([hash.get("team"), hash.get("type")], ["Gamma", "Feature"])
    assert.equal(await page.locator(".rp-matrix td").count(), 6)
    assert.equal(await page.locator(".rp-matrix td.is-dim").count(), 5)

    // A second click on the same value clears it.
    await page.locator(".rp-matrix td.is-click").last().click()
    await page.waitForFunction(() => !location.hash.includes("?"))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 60_000)
