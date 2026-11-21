// The code-along skill's build reads lesson.md with the page's own parser (assets/lesson.js) and fills
// assets/page.html, the same page an agent without Node fills by hand. This runs it on the skill's example.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { afterAll, test } from "vite-plus/test"
import { migrate } from "../cost/harness.mjs"

migrate()

const skill = fileURLToPath(new URL("../../skills/code-along/", import.meta.url))
const example = readFileSync(join(skill, "references/example.md"), "utf8")
const dir = mkdtempSync(join(tmpdir(), "code-along-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const context = vm.createContext({})
vm.runInContext(`${readFileSync(join(skill, "assets/lesson.js"), "utf8")}\nthis.parseLesson = parseLesson;`, context)
const parse = (source) => JSON.parse(JSON.stringify(context.parseLesson(source)))

function build(source) {
  const input = join(dir, "lesson.md")
  const output = join(dir, "lesson.html")
  const logPath = join(dir, "build.log")
  writeFileSync(input, source)
  const fd = openSync(logPath, "w")
  try {
    execFileSync(process.execPath, [join(skill, "scripts/build.mjs"), input, output], { stdio: ["ignore", fd, fd] })
    return { ok: true, log: readFileSync(logPath, "utf8"), html: readFileSync(output, "utf8") }
  } catch (error) {
    return { ok: false, log: readFileSync(logPath, "utf8") || error.message, html: "" }
  } finally {
    closeSync(fd)
  }
}

const slot = (html, id) => new RegExp(`<script id="${id}" type="application/json">([^<]*)</script>`).exec(html)[1]

test("the build fills every slot of the page with the example", () => {
  const { ok, html, log } = build(example)
  assert.ok(ok, log)
  assert.ok(html.includes("<title>Plurals with Intl.PluralRules</title>"))
  assert.equal(JSON.parse(slot(html, "lesson")), example)
  assert.match(html, /<style id="ca-style">\s*[\s\S]*\.ca-shell/)
  assert.match(JSON.parse(slot(html, "ca-lesson")), /function parseLesson\b/)
  assert.match(JSON.parse(slot(html, "ca-app")), /function mount\b/)
  // Nothing but the slots changes: text between the tags would show above the page.
  assert.doesNotMatch(html.replace(/<(script|style|title)\b[\s\S]*?<\/\1>/g, ""), />\s*[^<\s][^<]*</)
})

test("script tokenizer delimiters and original backslashes round-trip in the lesson slot", () => {
  const source = `## One\n\n\`\`\`js [main.js]\nconsole.log("<!--", "<script>", "</script>", /<\\/script>/)\n\`\`\`\n`
  const { ok, html } = build(source)
  assert.ok(ok)
  assert.equal(JSON.parse(slot(html, "lesson")), source)
})

test("each step has the step before's files plus its own, and marks the ones it changes", () => {
  const lesson = parse(example)
  assert.equal(lesson.title, "Plurals with Intl.PluralRules")
  assert.deepEqual(
    lesson.steps.map((s) => s.id),
    ["count-the-messages", "pick-the-form", "three-languages"],
  )
  const [first, second, third] = lesson.steps
  assert.deepEqual(Object.keys(first.files), ["index.html", "src/main.js", "style.css"])
  assert.deepEqual(Object.keys(second.files), ["index.html", "src/main.js", "src/messages.js", "style.css"])
  assert.deepEqual(second.changed, ["src/messages.js", "src/main.js"])
  assert.deepEqual(second.files["index.html"], first.files["index.html"])
  assert.match(third.files["src/messages.js"].content, /ar: \{/)
  // A step opens on the first file its text links to.
  assert.equal(second.active, "src/messages.js")
  assert.match(lesson.intro, /^You'll make/)
})

test("the build stops on what the page couldn't show, and names the fix", () => {
  const cases = [
    ["# Title\n\nNo steps.\n", /has no ## step/],
    ["## One\n\nJust words.\n", /step "One" \(line 1\) has no files/],
    [
      "## One\n\n[x](src/b.js)\n\n```js [src/a.js]\n1\n```\n",
      /links to src\/b\.js, which isn't one of its files \(src\/a\.js\)/,
    ],
    ["## One\n\n```js [src/a.js]\n1\n", /never closes/],
    ["## One\n\n```js [../a.js]\n1\n```\n", /isn't a file path/],
    ["```js [a.js]\n1\n```\n\n## One\n\n```js [b.js]\n2\n```\n", /a\.js sits before the first ## step/],
  ]
  for (const [source, error] of cases) {
    const { ok, log } = build(source)
    assert.equal(ok, false, source)
    assert.match(log, error)
  }
})

test("a lesson after a blank line still reads its frontmatter", () => {
  const lesson = parse("\n\n---\ntitle: Hi\nguide: right\n---\n\n## One\n\n```js [a.js]\n1\n```\n")
  assert.equal(lesson.title, "Hi")
  assert.equal(lesson.guide, "right")
  assert.equal(lesson.intro, "")
})

test("line links and plain fences stay in the guide", () => {
  const lesson = parse("## One\n\nSee [lines](a.js#L2-L3).\n\n```js\nnot a file\n```\n\n```js [a.js]\n1\n2\n3\n```\n")
  const [step] = lesson.steps
  assert.deepEqual(Object.keys(step.files), ["a.js"])
  assert.match(step.guide, /not a file/)
  assert.equal(step.files["a.js"].content, "1\n2\n3\n")
})

// Snyk fails a skill whose page runs code fetched from a URL that can change, so the page only runs what it holds.
test("an unfilled page names the missing file instead of loading it from Drop", async () => {
  const page = readFileSync(join(skill, "assets/page.html"), "utf8")
  assert.doesNotMatch(page, /drop\.vitehub\.dev/)
  assert.match(page, /isn't in the page/)
  const { findSkill } = await import("../../server/utils/skills.ts")
  const paths = new Set(findSkill("code-along").files.map((file) => file.path))
  for (const path of [
    "assets/app.js",
    "assets/lesson.js",
    "assets/style.css",
    "assets/page.html",
    "scripts/build.mjs",
    "references/example.md",
  ])
    assert.ok(paths.has(path), `missing ${path}`)
})
