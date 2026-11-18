// A data-explorer page filters on a click anywhere a list filter's value is drawn: a bar, a legend entry, a category's
// axis label, a line under the pointer, a line's name, a matrix cell and a mark of a raw vega block. A histogram's bin
// filters by its range. Each click shows in the URL's hash, and the block clicked keeps every value and fades the
// others.
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

// Hours 0 to 39 fall in 4 bins of 10; the teams take every third issue.
const issues = Array.from({ length: 40 }, (_, i) => ({ id: `#${i + 1}`, team: Object.keys(teams)[i % 3], hours: i }))
const spread = {
  title: "Issue hours",
  subtitle: "Test data",
  filters: [{ field: "team", type: "list", label: "Teams", count: "issues" }],
  data: {
    issues,
    byTeam: Object.keys(teams).map((team) => ({ team, count: issues.filter((r) => r.team === team).length })),
  },
  views: [
    {
      id: "spread",
      label: "Spread",
      blocks: [
        {
          type: "chart",
          chart: "histogram",
          title: "Hours per issue",
          data: "issues",
          x: "hours",
          xTitle: "Hours",
          bins: 4,
        },
        {
          type: "vega",
          title: "Issues per team",
          spec: {
            data: { name: "byTeam" },
            mark: "bar",
            encoding: {
              x: { field: "team", type: "nominal" },
              y: { field: "count", type: "quantitative" },
              color: { field: "team", type: "nominal", legend: null },
            },
          },
        },
      ],
    },
  ],
  bottom: [
    {
      type: "table",
      style: "rows",
      title: "Issues",
      data: "issues",
      columns: [{ field: "id" }, { field: "team", format: "entity" }, { field: "hours" }],
    },
  ],
}

test("a click on a histogram bin filters by its range, and a click on a vega mark by its list filter", async () => {
  writeFileSync(join(dir, "spread.json"), JSON.stringify(spread))
  execFileSync("node", [join(skill, "scripts/build.mjs"), "spread.json", "spread.html"], { cwd: dir, stdio: "pipe" })
  const browser = await chromium.launch()
  try {
    for (const phone of [false, true]) {
      const page = await browser.newPage(
        phone
          ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
          : { viewport: { width: 1300, height: 1200 } },
      )
      page.setDefaultTimeout(5000)
      const errors = []
      page.on("pageerror", (error) => errors.push(String(error)))
      await page.route("https://cdn.jsdelivr.net/npm/**", (route) => {
        const name = Object.keys(vega).find((key) => route.request().url().includes(`/npm/${key}/`))
        return name ? route.fulfill({ contentType: "text/javascript", body: readFileSync(vega[name]) }) : route.abort()
      })
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort())
      const chart = (title) =>
        page
          .locator("section.rp-block")
          .filter({ has: page.locator("h3", { hasText: title }) })
          .locator("svg")
          .first()
      const drawn = () =>
        page.waitForFunction(() => document.querySelectorAll('.rp-chart[data-state="ok"] svg').length === 2)
      const hash = async () =>
        new URLSearchParams(decodeURIComponent(await page.evaluate(() => location.hash)).split("?")[1] ?? "")
      // A bin's label starts with its range under the histogram's `xTitle`.
      const bin = (range) => chart("Hours per issue").locator(`.role-mark path[aria-label^="Hours: ${range};"]`)
      const press = (locator) => (phone ? locator.tap() : locator.click())
      const opacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity))
      const matching = () => page.locator("h3", { hasText: "Issues" }).locator(".rp-muted").textContent()

      await page.goto(`file://${join(dir, "spread.html")}#spread`)
      await drawn()
      await press(bin("10 – 20"))
      await page.waitForFunction(() => location.hash.includes("?"))
      assert.equal((await hash()).get("hours"), "10..20")
      await drawn()
      assert.equal(await matching(), " 10 matching")
      assert.equal(await chart("Hours per issue").locator(".role-mark path").count(), 4)
      assert.deepEqual(
        await Promise.all(["0 – 10", "10 – 20", "20 – 30", "30 – 40"].map((range) => opacity(bin(range)))),
        [0.2, 1, 0.2, 0.2],
      )
      assert.match(await page.locator(".rp-side").textContent(), /Hours\s*Clear\s*10 – 20/)
      if (phone)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll")
      // A second click on the same bin clears it.
      await press(bin("10 – 20"))
      await page.waitForFunction(() => !location.hash.includes("?"))
      await drawn()
      assert.equal(await matching(), " 40 matching")

      await press(chart("Issues per team").locator('.role-mark path[aria-label*="team: Beta"]'))
      await page.waitForFunction(() => location.hash.includes("?"))
      assert.equal((await hash()).get("team"), "Beta")
      await drawn()
      assert.equal(await matching(), " 13 matching")
      const bars = chart("Issues per team").locator(".role-mark path")
      assert.equal(await bars.count(), 3)
      assert.equal(await opacity(chart("Issues per team").locator('.role-mark path[aria-label*="team: Alpha"]')), 0.2)
      assert.equal(await opacity(chart("Issues per team").locator('.role-mark path[aria-label*="team: Beta"]')), 1)
      await press(chart("Issues per team").locator(".role-axis-label text", { hasText: "Gamma" }))
      await page.waitForFunction(() => location.hash.includes("team=Gamma"))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
}, 60_000)
