// The data-explorer skill's build fills assets/page.html, the same page an agent without Node fills by hand. This runs
// it on the example in references/blocks.md, as an agent would, and reads the page it writes.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, test } from "vite-plus/test"
import { migrate } from "../cost/harness.mjs"

migrate()

const skill = fileURLToPath(new URL("../../skills/data-explorer/", import.meta.url))
const reference = readFileSync(join(skill, "references/blocks.md"), "utf8")
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(reference)[1])
const dir = mkdtempSync(join(tmpdir(), "data-explorer-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function build(report) {
  const input = join(dir, "report.json")
  const output = join(dir, "report.html")
  writeFileSync(input, JSON.stringify(report))
  try {
    const log = execFileSync("node", [join(skill, "scripts/build.mjs"), input, output], { cwd: dir, encoding: "utf8" })
    return { ok: true, log, html: readFileSync(output, "utf8") }
  } catch (error) {
    return { ok: false, log: String(error.stdout), html: "" }
  }
}

test("the build fills every slot of the page with the example", () => {
  const { ok, html } = build(example)
  assert.ok(ok)
  assert.ok(html.includes(`<title>${example.title}</title>`))
  const data = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.deepEqual(JSON.parse(data), example)
  assert.match(html, /<style id="rp-style">\s*[\s\S]*\.rp-top/)
  assert.match(html, /<script id="rp-app" type="text\/plain">\s*[\s\S]*function render\b/)
  // Nothing but the slots changes: text between the tags would show above the page.
  assert.doesNotMatch(html.replace(/<(script|style|title)\b[\s\S]*?<\/\1>/g, ""), />\s*[^<\s][^<]*</)
})

test("the build names the field and the fix when the text runs long", () => {
  const { ok, log } = build({ ...example, title: "A title much longer than the forty characters a top bar holds" })
  assert.equal(ok, false)
  assert.match(log, /error\s+.*title/)
})

test("an unfilled page loads the template from this skill on Drop", async () => {
  const page = readFileSync(join(skill, "assets/page.html"), "utf8")
  assert.match(page, /https:\/\/drop\.vitehub\.dev\/\.well-known\/skills\/data-explorer\/assets\//)
  const { findSkill } = await import("../../server/utils/skills.ts")
  const paths = new Set(findSkill("data-explorer").files.map((file) => file.path))
  for (const path of [
    "assets/app.js",
    "assets/style.css",
    "assets/page.html",
    "scripts/build.mjs",
    "scripts/check.mjs",
  ])
    assert.ok(paths.has(path), `missing ${path}`)
})

test("the build names a list written as an object instead of crashing", () => {
  const { ok, log } = build({ ...example, views: { ...example.views[0] } })
  assert.equal(ok, false)
  assert.match(log, /error\s+report: `views` must be an array/)
})

test("the build warns when a filter has no type, since it would guess one", () => {
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"]
  const { ok, log } = build({ ...example, filters: [...example.filters, { field: "period", options: years }] })
  assert.ok(ok)
  assert.match(log, /warning\s+filters\[4\]: has no `type`, so it shows as a `list`/)
})
