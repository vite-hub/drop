import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { deferImages } from "../../shared/embedded-images.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const image = "/f/11111111-1111-4111-8111-111111111111.png"
const filler = Array.from({ length: 40 }, (_, i) => `Line ${i} of the plan.`).join("\n\n")
const markdown = `# Plan\n\n## Setup\n\n![The settings page](https://drop.test${image})\n\n${filler}\n\n## Walkthrough\n\n${filler}\n`
// The doc's body as the server renders it, with its image waiting for the viewer as DropViewer sends it.
const body = deferImages((await renderMarkdownCached("doc-links", async () => markdown)).html, [image])

async function open(browser) {
  const html = planDocument("markdown", "# Plan", false, body)
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}" style="width:1380px;height:780px;border:0"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/d/plan")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return { page, frame: page.frames()[1] }
}
const posted = (page, type) => page.evaluate((kind) => window.posts.filter((m) => m.type === kind), type)
// Messages cross the frame after the click returns.
const arrived = (page, type, count = 1) =>
  page.waitForFunction(([kind, n]) => window.posts.filter((m) => m.type === kind).length >= n, [type, count])

test("a heading's # links to its section on Drop, copies that link through Drop, and Drop's #id opens the doc there", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    const anchor = frame.locator("#setup + a.cl-anchor")
    // Before Drop sends its link, and after: the browser's Copy link address gives Drop's page, not about:srcdoc.
    assert.equal(await anchor.getAttribute("href"), "#setup")
    await page.evaluate(() => window.tell({ type: "page-link", href: "https://drop.test/d/plan/seo?v=2#old" }))
    await frame.waitForFunction(
      () => document.querySelector("#setup + a.cl-anchor").href === "https://drop.test/d/plan/seo?v=2#setup",
    )
    await frame.locator("#setup").hover()
    await anchor.click()
    await arrived(page, "heading")
    assert.deepEqual(await posted(page, "heading"), [{ __drop: true, type: "heading", id: "setup", copy: true }])
    assert.equal(page.frames()[1].url(), "about:srcdoc", "the frame stays on the doc")

    await page.evaluate(() => window.tell({ type: "heading", id: "walkthrough" }))
    await frame.waitForFunction(() => Math.abs(document.getElementById("walkthrough").getBoundingClientRect().top) < 40)

    // The outline's links keep Drop's address on the section too.
    await frame
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link", { name: "Setup", exact: true })
      .click()
    await arrived(page, "heading", 2)
    assert.deepEqual((await posted(page, "heading"))[1], { __drop: true, type: "heading", id: "setup" })
  } finally {
    await browser.close()
  }
})

test("an image's link button copies the file's own address, not the data: URL the frame shows it from", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    const picture = frame.getByRole("img", { name: "The settings page" })
    assert.match(await picture.getAttribute("src"), /^data:/)
    await picture.hover()
    await frame.getByRole("button", { name: "Copy image link" }).click()
    await arrived(page, "copy")
    assert.deepEqual(await posted(page, "copy"), [{ __drop: true, type: "copy", text: `https://drop.test${image}` }])
    // The click copied; it didn't open the image's zoom.
    assert.deepEqual(await posted(page, "image"), [])
  } finally {
    await browser.close()
  }
})
