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
