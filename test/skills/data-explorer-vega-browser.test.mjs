// A raw vega block takes the page's colors by name: a color on a list filter's field draws each name in the color the
// sidebar gives it (Gamma, the biggest, takes the first), a tone such as `bad` is the page's red, and a theme color such as `fg` follows light and dark.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
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

for (const [name, layer, datasets, expected] of [
  [
    "dataset color values stay literal",
    [
      {
        data: { name: "items" },
        mark: "text",
        encoding: { x: { value: 20 }, y: { value: 20 }, text: { field: "color" } },
      },
    ],
    { items: [{ color: "bad" }, { color: "good" }] },
    { text: ["bad", "good"] },
  ],
  [
    "disabled scales use literal colors",
    [{ mark: "bar", encoding: { color: { field: "team", type: "nominal", scale: null } } }],
    undefined,
    { fills: ["red", "green", "blue"] },
  ],
  ["numeric mark paints use the palette", [{ mark: { type: "bar", color: 2 } }], undefined, { palette: true }],
  [
    "numeric gradient stops use the palette",
    [
      {
        mark: {
          type: "bar",
          color: {
            gradient: "linear",
            stops: [
              { offset: 0, color: 0 },
              { offset: 1, color: 2 },
            ],
          },
        },
      },
    ],
    undefined,
    { stops: true },
  ],
  [
    "conditional ranges resolve aliases",
    [
      {
        mark: "bar",
        encoding: {
          color: {
            condition: { test: "true", field: "team", type: "nominal", scale: { range: ["good", "warn", "bad"] } },
            value: "muted",
          },
        },
      },
    ],
    undefined,
    { fills: ["#3f9d5a", "#e0894a", "#cf3f4e"] },
  ],
  [
    "conditional fields inherit sidebar colors",
    [
      {
        mark: "bar",
        encoding: { color: { condition: { test: "true", field: "team", type: "nominal" }, value: "muted" } },
      },
    ],
    undefined,
    { sidebar: true },
  ],
])
  test(
    name,
    async () => {
      const input = structuredClone(report)
      input.data.byTeam.forEach((row, i) => {
        row.team = ["red", "green", "blue"][i]
      })
      input.views[0].blocks[0].spec = {
        data: { name: "byTeam" },
        datasets,
        layer: layer.map((item) => ({
          ...item,
          encoding: {
            x: { field: "team", type: "nominal" },
            y: { field: "count", type: "quantitative" },
            ...item.encoding,
          },
        })),
      }
      writeFileSync(join(dir, "report.json"), JSON.stringify(input))
      execFileSync("node", [join(skill, "scripts/build.mjs"), "report.json", "report.html"], {
        cwd: dir,
        stdio: "pipe",
      })
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        await page.route("https://cdn.jsdelivr.net/npm/**", (route) => {
          const key = Object.keys(vega).find((key) => route.request().url().includes(`/npm/${key}/`))
          return key ? route.fulfill({ contentType: "text/javascript", body: readFileSync(vega[key]) }) : route.abort()
        })
        await page.route("https://fonts.googleapis.com/**", (route) => route.abort())
        await page.goto(`file://${join(dir, "report.html")}?theme=light#overview`)
        await page.waitForFunction(() => document.querySelector('.rp-chart[data-state="ok"] svg'))
        const actual = await page.evaluate(() => {
          const svg = document.querySelector(".rp-chart svg")
          return {
            fills: [...svg.querySelectorAll(".mark-rect.role-mark path")].map((el) => el.getAttribute("fill")),
            text: [...svg.querySelectorAll(".mark-text.role-mark text")].map((el) => el.textContent),
            gradients: [...svg.querySelectorAll("linearGradient")].map((gradient) =>
              [...gradient.querySelectorAll("stop")].map((el) => el.getAttribute("stop-color")),
            ),
            dots: [...document.querySelectorAll(".rp-dot")].map((el) => el.style.background),
          }
        })
        if (expected.text) assert.deepEqual(actual.text.sort(), expected.text)
        if (expected.fills) assert.deepEqual(actual.fills.sort(), expected.fills.sort())
        if (expected.palette) {
          assert.equal(actual.fills.length, 3)
          assert.ok(actual.fills.every((v) => /^#[\da-f]{6}$/i.test(v)))
        }
        if (expected.stops) {
          assert.equal(actual.gradients.length, 3)
          for (const stops of actual.gradients) assert.deepEqual(stops, ["#4d97de", "#3ca694"])
        }
        if (expected.sidebar) {
          assert.equal(actual.fills.length, 3)
          const normalized = await page.evaluate(
            (fills) =>
              fills.map((fill) => {
                const el = document.createElement("i")
                el.style.background = fill
                return el.style.background
              }),
            actual.fills,
          )
          assert.deepEqual(normalized.sort(), actual.dots.sort())
        }
      } finally {
        await browser.close()
      }
    },
    60_000,
  )

test("paint preprocessing preserves nested records and explicit scale choices", () => {
  const app = readFileSync(join(skill, "assets/app.js"), "utf8")
  const paint = runInNewContext(`${app.slice(app.indexOf("const PALETTE"), app.indexOf("const report"))}
    const COLORS = { team: new Map([["Alpha", "#123456"]]) };
    ${app.slice(app.indexOf("const PAINT"), app.indexOf("function vegaSpec"))}
    paintSpec`)
  const records = [{ color: "bad", fill: "good", stroke: 2 }]
  const node = {
    params: [
      {
        name: "brush",
        value: { color: "bad", fill: "good", stroke: 2 },
        select: { type: "interval", mark: { fill: "accent", stroke: "bad" } },
      },
    ],
    datasets: { items: structuredClone(records) },
    layer: [{ data: { values: structuredClone(records) }, spec: { datasets: { nested: structuredClone(records) } } }],
    mark: { color: 2, fill: 0, stroke: 1 },
    encoding: {
      color: { condition: { field: "team", scale: null } },
      fill: { condition: { field: "team", scale: { scheme: "category10" } } },
      stroke: { field: "team", scale: { range: ["good", 2] } },
    },
  }
  paint(node, undefined, {})
  assert.deepEqual(node.params[0].value, records[0])
  assert.deepEqual(node.params[0].select.mark, { fill: "#4d97de", stroke: "#cf3f4e" })
  assert.deepEqual(node.datasets.items, records)
  assert.deepEqual(node.layer[0].data.values, records)
  assert.deepEqual(node.layer[0].spec.datasets.nested, records)
  assert.deepEqual(node.mark, { color: "#3ca694", fill: "#4d97de", stroke: "#e0894a" })
  assert.equal(node.encoding.color.condition.scale, null)
  assert.deepEqual(node.encoding.fill.condition.scale, { scheme: "category10" })
  assert.deepEqual(node.encoding.stroke.scale.range, ["#3f9d5a", "#3ca694"])
})
