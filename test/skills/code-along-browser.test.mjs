import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { htmlLanding, HTML_CONTENT_SECURITY_POLICY } from "../../shared/html-landing.ts"

const skill = fileURLToPath(new URL("../../skills/code-along/", import.meta.url))
const require = createRequire(import.meta.url)
const lexer = readFileSync(createRequire(require.resolve("vite-plus")).resolve("es-module-lexer/js"), "utf8")

function build(source) {
  const dir = mkdtempSync(join(tmpdir(), "code-along-browser-"))
  try {
    const input = join(dir, "lesson.md")
    const output = join(dir, "lesson.html")
    writeFileSync(input, source)
    execFileSync(process.execPath, [join(skill, "scripts/build.mjs"), input, output], { stdio: "inherit" })
    return readFileSync(output, "utf8")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const fenced = (path, source) => `\`\`\`text [${path}]\n${source}\n\`\`\``
const original = 'console.log("<!--", "<script>", "</script>", /<\\/script>/)'
const lesson = [
  "## First\n\n[a.js](a.js)",
  fenced("a.js", original),
  fenced("b.js", "const b = 1"),
  "## 次の手順\n\n[b.js](b.js) is the default.\n\n| File |\n| --- |\n| [a.js](a.js#L1) |\n\nThis comment belongs to the second step.",
].join("\n\n")

async function open(browser, html, layout = "standalone") {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/lexer.asm.js"))
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: lexer,
      })
    if (url.pathname.endsWith("/marked.esm.js")) {
      const parse = `export const marked = { parse: (source) => source.split("\\n\\n").map((block) => {
        const html = block.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
        return html.startsWith('|') ? '<table><tr><td>' + html.split("\\n").at(-1).split('|')[1] + '</td></tr></table>' : '<p>' + html + '</p>';
      }).join('') }`
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: parse,
      })
    }
    if (url.hostname !== "drop.test") return route.abort()
    if (layout === "landing")
      return route.fulfill({
        contentType: "text/html",
        headers: { "content-security-policy": HTML_CONTENT_SECURITY_POLICY },
        body: htmlLanding(html, url.pathname),
      })
    if (layout === "viewer") {
      const source = planDocument("html", html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
      return route.fulfill({
        contentType: "text/html",
        body: `<iframe style="width:100%;height:760px" sandbox="${PREVIEW_SANDBOX}" srcdoc="${source}"></iframe>
        <script>window.posts = []; addEventListener("message", event => {
          if (event.data?.__drop) window.posts.push(event.data);
        });</script>`,
      })
    }
    return route.fulfill({ contentType: "text/html", body: html })
  })
  await page.goto("https://drop.test/")
  return { page, frame: layout === "standalone" ? page : page.frames()[1] }
}

test("built and manual lessons preserve source; Unicode and table links restore the right file", async () => {
  const browser = await chromium.launch()
  try {
    const html = build(lesson)
    const { page } = await open(browser, html)
    const editor = page.locator(".ca-textarea")
    assert.equal(await editor.inputValue(), original)
    await page.getByRole("button", { name: "Next" }).click()
    assert.equal(await editor.inputValue(), "const b = 1")
    await page.reload()
    assert.equal(await editor.inputValue(), "const b = 1")
    await page.locator(".ca-table a").click()
    assert.equal(await editor.inputValue(), original)
    await editor.fill("const saved = true")
    await page.evaluate(() => {
      location.hash = "#first"
    })
    await page.locator("#first:visible").waitFor()
    await page.evaluate(() => {
      location.hash = "#次の手順"
    })
    await page.getByText("This comment belongs to the second step.").waitFor()
    await page.locator(".ca-table a").click()
    assert.equal(await editor.inputValue(), "const saved = true")
    await page.reload()
    await page.locator(".ca-table a").click()
    assert.equal(await editor.inputValue(), "const saved = true")

    const encode = (code) => JSON.stringify(code).replaceAll("<", "\\u003c")
    const asset = (name) => readFileSync(join(skill, "assets", name), "utf8")
    const manual = asset("page.html")
      .replace('<style id="ca-style">', () => `<style id="ca-style">${asset("style.css")}`)
      .replace('id="lesson" type="application/json">', (slot) => slot + encode(lesson))
      .replace('id="ca-lesson" type="application/json">', (slot) => slot + encode(asset("lesson.js")))
      .replace('id="ca-app" type="application/json">', (slot) => slot + encode(asset("app.js")))
    const { frame } = await open(browser, manual, "landing")
    assert.equal(await frame.locator(".ca-textarea").inputValue(), original)
    await frame.getByText("Temporary edits: reloading may lose your changes.").waitFor()
  } finally {
    await browser.close()
  }
}, 30000)

test("Drop viewer comment focus reveals its step before and after lesson mount", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, build(lesson), "viewer")
    await page.waitForFunction(() => window.posts.some((message) => message.type === "ready"))
    await page.evaluate(() => {
      const send = (message) => frames[0].postMessage({ __drop: true, ...message }, "*")
      send({ type: "focus", id: "c1" })
      send({
        type: "markers",
        markers: [
          {
            id: "c1",
            n: 1,
            kind: "text",
            selector: '[data-step="次の手順"] p:last-child',
            quote: "This comment belongs to the second step.",
            author: "Reader",
            body: "Comment",
            replies: 0,
          },
        ],
      })
    })
    await frame.getByText("This comment belongs to the second step.").waitFor()
    await frame.getByRole("button", { name: "Back" }).click()
    await page.evaluate(() => frames[0].postMessage({ __drop: true, type: "focus", id: "c1" }, "*"))
    await frame.getByText("This comment belongs to the second step.").waitFor()
  } finally {
    await browser.close()
  }
}, 30000)

test("the Drop landing preview evaluates real modules, waits for TLA and serves virtual HTML", async () => {
  const browser = await chromium.launch()
  try {
    const source = [
      "## Native modules",
      fenced("index.html", '<output></output><script type="module" src="./main.js"></script>'),
      fenced("dep.js", "export let count = 0; export const increment = () => ++count;"),
      fenced("partial.html", "<b>Partial</b>"),
      fenced(
        "main.js",
        [
          'import { count, increment } from "./dep.js";',
          'const literal = `import "./not-a-module.js"`;',
          'addEventListener("DOMContentLoaded", () => { document.body.dataset.domReady = "true"; });',
          'const partial = await (await fetch("./partial.html")).text();',
          'increment(); document.querySelector("output").textContent = `${count} ${partial} ${literal}`;',
        ].join("\n"),
      ),
      "## Slow failure",
      fenced(
        "main.js",
        'await new Promise(resolve => setTimeout(resolve, 800)); throw new Error("late module failure");',
      ),
    ].join("\n\n")
    const { frame } = await open(browser, build(source), "landing")
    const shell = frame.locator('.ca-shell[data-preview="ready"]')
    await shell.waitFor()
    const preview = frame.childFrames()[0]
    assert.equal(await preview.locator("output").textContent(), '1 <b>Partial</b> import "./not-a-module.js"')
    assert.equal(await preview.locator("body").getAttribute("data-dom-ready"), "true")
    await frame.getByRole("button", { name: "Next" }).click()
    await frame.locator('.ca-shell[data-preview="running"]').waitFor()
    await frame.locator('.ca-shell[data-preview="failed"]').waitFor()
    await frame
      .locator(".ca-log.is-error")
      .filter({ hasText: "late module failure" })
      .first()
      .waitFor({ state: "attached" })
  } finally {
    await browser.close()
  }
}, 30000)
