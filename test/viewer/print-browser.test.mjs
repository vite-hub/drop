import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX, previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// A dark Markdown doc in the viewer's frame, the way DropViewer renders one without a content origin.
async function open(browser, sandbox) {
  const html = planDocument("markdown", "# Plan", true, "<h1>Plan</h1><p>Launch on November 18.</p>")
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage()
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<iframe sandbox="${sandbox}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  // What the page looks like as it prints: this listener runs after the runtime's own beforeprint.
  await frame.evaluate(() => {
    window.printed = []
    addEventListener("beforeprint", () =>
      window.printed.push({ title: document.title, dark: document.documentElement.classList.contains("dark") }),
    )
  })
  return { page, frame }
}

test("Export as PDF prints a Markdown doc light, under the drop's title, without Drop's pins", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, previewSandbox("markdown"))
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0)
    const [printed] = await frame.evaluate(() => window.printed)
    assert.equal(printed.title, "SEO plan")
    assert.equal(printed.dark, false)
    // Back to the reader's dark mode once the dialog closes.
    await frame.waitForFunction(() => document.documentElement.classList.contains("dark"))

    await page.emulateMedia({ media: "print" })
    assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector("drop-comments")).display), "none")
  } finally {
    await browser.close()
  }
})

test("other drops' frames can't open the print dialog", async () => {
  assert.equal(previewSandbox("html"), PREVIEW_SANDBOX)
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, PREVIEW_SANDBOX)
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await page.waitForTimeout(300)
    assert.deepEqual(await frame.evaluate(() => window.printed), [])
  } finally {
    await browser.close()
  }
})

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
const PENDING = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
const NEAR = "/f/00000000-0000-4000-8000-000000000001.png"
const FAR = "/f/00000000-0000-4000-8000-000000000002.png"
const LINK = "k7f2q9m4x8wd"
const FILLER = "<p>Launch on November 18.</p>".repeat(30)

// A doc whose first image is on screen, a second one about five screens down and another drop's box further still,
// in a frame of one screen. The viewer answers `files` and `embeds` after a pause, or never.
async function openLazy(browser, { answers }) {
  const html = planDocument(
    "markdown",
    "",
    false,
    `<h1>Plan</h1><p><img src="${PENDING}" data-drop-image="${NEAR}" alt="near"></p>${FILLER.repeat(5)}` +
      `<p><img src="${PENDING}" data-drop-image="${FAR}" alt="far"></p>${FILLER.repeat(2)}` +
      `<figure class="drop-embed" data-drop-embed="${LINK}" data-title="Steps"><a class="drop-embed-link" href="/d/${LINK}">Steps</a></figure>`,
  )
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:700px;display:block}</style>
            <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; window.delivered = [];
              const answers = ${answers};
              const answer = (source, message) => setTimeout(() => {
                window.delivered.push(message.path || message.link);
                source.postMessage({ __drop: true, ...message }, "*");
              }, 600);
              addEventListener("message", (e) => {
                if (!e.data?.__drop) return;
                window.posts.push(e.data);
                if (!answers) return;
                if (e.data.type === "files") for (const path of e.data.paths) answer(e.source, { type: "file-data", path, data: ${JSON.stringify(PNG)} });
                if (e.data.type === "embeds") for (const link of e.data.links) answer(e.source, { type: "embed-data", link, html: "<!doctype html><p>Steps</p>" });
              });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  await frame.evaluate(() => {
    window.printed = []
    addEventListener("beforeprint", () =>
      window.printed.push({
        at: Date.now(),
        placeholders: document.querySelectorAll("img[data-drop-image]").length,
        unfilled: document.querySelectorAll("[data-drop-embed]").length,
        frames: document.querySelectorAll(".drop-embed iframe").length,
      }),
    )
  })
  return { page, frame }
}

const asked = (posts) => ({
  files: posts
    .filter((m) => m.type === "files")
    .flatMap((m) => m.paths)
    .sort(),
  embeds: posts.filter((m) => m.type === "embeds").flatMap((m) => m.links),
})

test("Export as PDF asks for the files and drops further down and prints once they're on the page", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: true })
    // Only what's near the screen is asked for while reading.
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [NEAR], embeds: [] })

    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 10_000 })
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [FAR, NEAR].sort(), embeds: [LINK] })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual(
      { placeholders: printed.placeholders, unfilled: printed.unfilled, frames: printed.frames },
      { placeholders: 0, unfilled: 0, frames: 1 },
    )
    assert.deepEqual((await page.evaluate(() => window.delivered)).sort(), [FAR, LINK, NEAR].sort())
    assert.equal(await frame.evaluate(() => document.title), "SEO plan")
  } finally {
    await browser.close()
  }
}, 30_000)

test("Export as PDF still prints when the viewer never sends the files", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: false })
    const sent = await frame.evaluate(() => Date.now())
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await page.waitForTimeout(1_000)
    assert.deepEqual(await frame.evaluate(() => window.printed), [])
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [FAR, NEAR].sort(), embeds: [LINK] })

    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 25_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.ok(printed.at - sent >= 15_000, `printed after ${printed.at - sent} ms`)
    assert.equal(printed.placeholders, 2)
  } finally {
    await browser.close()
  }
}, 40_000)
