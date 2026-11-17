// A raw vega block takes the page's colors by name: a color on a list filter's field draws each name in the color the
// sidebar gives it (Gamma, the biggest, takes the first), a tone such as `bad` is the page's red, and a theme color such as `fg` follows light and dark.
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
const dir = mkdtempSync(join(tmpdir(), "data-explorer-vega-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Vega comes with comark-ui's charts; the page asks jsDelivr for it, and the test answers from these files.
const charts = createRequire(createRequire(import.meta.url).resolve("comark-ui/package.json"))
const from = createRequire(charts.resolve("comark-charts/package.json"))
const vega = {
  "vega@6": join(dirname(from.resolve("vega")), "vega.min.js"),
  "vega-lite@6": join(dirname(from.resolve("vega-lite")), "vega-lite.min.js"),
}

const spec = {
  data: { name: "byTeam" },
  layer: [
    {
      mark: "bar",
      encoding: {
        x: { field: "team", type: "nominal" },
        y: { field: "count", type: "quantitative" },
        color: { field: "team", type: "nominal", legend: null },
      },
    },
    { mark: { type: "rule", color: "bad", strokeWidth: 2 }, encoding: { y: { datum: 20 } } },
    {
      mark: { type: "text", dy: -6 },
      encoding: {
        x: { field: "team", type: "nominal" },
        y: { field: "count", type: "quantitative" },
        text: { field: "count" },
        color: { value: "fg" },
      },
    },
  ],
}
const report = {
  title: "Vega colors",
  subtitle: "Test data",
  filters: [{ field: "team", type: "list", label: "Teams", count: "byTeam", countField: "count" }],
  data: {
    byTeam: [
      { team: "Alpha", count: 6 },
      { team: "Beta", count: 18 },
      { team: "Gamma", count: 30 },
    ],
  },
  views: [{ id: "overview", label: "Overview", blocks: [{ type: "vega", title: "By team", spec }] }],
}

test("a vega block names the page's colors instead of copying them", async () => {
  assert.doesNotMatch(JSON.stringify(spec), /#[\da-f]{3,8}\b/i)
  writeFileSync(join(dir, "report.json"), JSON.stringify(report))
  execFileSync("node", [join(skill, "scripts/build.mjs"), "report.json", "report.html"], { cwd: dir, stdio: "pipe" })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.route("https://cdn.jsdelivr.net/npm/**", (route) => {
      const name = Object.keys(vega).find((key) => route.request().url().includes(`/npm/${key}/`))
      return name ? route.fulfill({ contentType: "text/javascript", body: readFileSync(vega[name]) }) : route.abort()
    })
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort())

    for (const theme of ["light", "dark"]) {
      await page.goto(`file://${join(dir, "report.html")}?theme=${theme}#overview`)
      await page.waitForFunction(() => document.querySelector('.rp-chart[data-state="ok"] svg'))
      const colors = await page.evaluate(() => {
        const svg = document.querySelector(".rp-chart svg")
        const fill = (el) => getComputedStyle(el).fill
        const css = (name) => {
          const probe = document.createElement("i")
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name)
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        }
        const sidebar = Object.fromEntries(
          [...document.querySelectorAll(".rp-side .rp-dot, aside .rp-dot")].map((dot) => [
            dot.parentElement.textContent.replace(/\d+$/, "").trim(),
            getComputedStyle(dot).backgroundColor,
          ]),
        )
        return {
          bars: Object.fromEntries(
            [...svg.querySelectorAll('.mark-rect path[aria-label*="team: "]')].map((bar) => [
              bar.getAttribute("aria-label").match(/team: (\w+)/)[1],
              fill(bar),
            ]),
          ),
          sidebar,
          rule: getComputedStyle(svg.querySelector(".mark-rule.role-mark line")).stroke,
          text: [...new Set([...svg.querySelectorAll(".mark-text.role-mark text")].map(fill))],
          fg: css("--rp-fg"),
        }
      })
      assert.deepEqual(Object.keys(colors.bars).sort(), ["Alpha", "Beta", "Gamma"], theme)
      for (const [team, color] of Object.entries(colors.bars))
        assert.equal(color, colors.sidebar[team], `${team} in ${theme}`)
      assert.equal(colors.rule, "rgb(207, 63, 78)", theme)
      assert.deepEqual(colors.text, [colors.fg], theme)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 60_000)
