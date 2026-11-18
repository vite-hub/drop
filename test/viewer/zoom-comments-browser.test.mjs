import assert from "node:assert/strict"
import { chromium, firefox } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { migrate } from "../cost/harness.mjs"
import { renderMarkdownCached } from "../../server/utils/markdown-document.ts"

migrate()

// Comark's zoom is a modal <dialog>, which makes everything outside it inert, Drop's comment layer included. The layer
// moves into the dialog while it's open, so a pin still lands on the zoomed screenshot, and comes back on close.
const markdown = `# Zoom

A paragraph to comment on once the zoom is closed.

:::screenshot{src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#2020ed"/></svg>')}" alt="Settings page" title="Settings"}
::::annotation{x=5 y=5 w=20 h=20}
A note.
::::
:::
`

async function open(browser, html) {
  const escaped = planDocument("markdown", "", false, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.route("https://drop.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:680px;display:block}</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
        window.send = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
    }),
  )
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => posts.some((m) => m.type === "ready"), null, { timeout: 10_000 })
  return { page, frame: page.frames()[1] }
}

async function setTool(page, tool) {
  await page.evaluate(() => (posts.length = 0))
  await page.evaluate((tool) => send({ type: "tool", tool }), tool)
  await page.waitForFunction((tool) => posts.some((m) => m.type === "tool" && m.tool === tool), tool, { timeout: 5000 })
}

async function drag(page, box) {
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x - 30, y - 15)
  await page.mouse.down()
  await page.mouse.move(x + 30, y + 15, { steps: 5 })
  await page.mouse.up()
  const area = await page.waitForFunction(() => posts.find((m) => m.type === "area"), null, { timeout: 5000 })
  return area.jsonValue()
}

// The page's own layer, not the ones the zoom's copy and notes get: it's the one above everything.
const hostParent = (frame) =>
  frame.evaluate(
    () => [...document.querySelectorAll("drop-comments")].find((host) => host.style.zIndex).parentElement.localName,
  )

for (const [name, engine] of [
  ["Chromium", chromium],
  ["Firefox", firefox],
]) {
  test(`a comment lands on a zoomed screenshot, and on the page after the zoom closes (${name})`, async () => {
    const { html } = await renderMarkdownCached("zoom-comments.md", async () => markdown)
    const browser = await engine.launch()
    try {
      const { page, frame } = await open(browser, html)
      await frame.locator(".ca-screenshot [data-zoom]").click()
      await frame.locator("dialog.cz-dialog").waitFor()
      assert.equal(await frame.evaluate(() => document.querySelector("dialog.cz-dialog").matches(":modal")), true)
      assert.equal(await hostParent(frame), "dialog", "the layer moves into the zoom's dialog")

      await setTool(page, "comment")
      const zoomed = await frame.locator('.cz-item img[alt="Settings page"]').boundingBox()
      const onShot = await drag(page, zoomed)
      assert.equal(onShot.kind, "image", "the area anchors to the screenshot, not to whatever the dialog covers")
      assert.equal(onShot.label, "Settings page")

      // Marker ink drawn on the zoom stays over the screenshot while the comment is written, in Browse, as it does on
      // the page; the page's own drafts stay hidden behind the zoom.
      await page.evaluate(() => (posts.length = 0))
      await page.evaluate(() =>
        send({ type: "tool", tool: "mark", pen: { tool: "marker", color: "#ec4899", width: 14 } }),
      )
      await frame.waitForFunction(() =>
        [...document.querySelectorAll("drop-comments")]
          .find((h) => h.style.zIndex)
          .shadowRoot.querySelector(".draw.mark"),
      )
      const cx = zoomed.x + zoomed.width / 2,
        cy = zoomed.y + zoomed.height / 2
      await page.mouse.move(cx - 40, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 40, cy, { steps: 10 })
      await page.mouse.up()
      await page.evaluate(() => send({ type: "mark", do: "done" }))
      await page.waitForFunction(() => posts.some((m) => m.type === "area"), null, { timeout: 10_000 })
      await setTool(page, "browse")
      const ink = await frame.evaluate(() => {
        const svg = [...document.querySelectorAll("drop-comments")]
          .find((h) => h.style.zIndex)
          .shadowRoot.querySelector(".draft .inkp")
        const box = svg.querySelector("path").getBoundingClientRect()
        return { display: getComputedStyle(svg).display, x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      assert.notEqual(ink.display, "none", "the kept ink shows on the zoom")
      assert.ok(
        Math.abs(ink.x - cx) < 6 && Math.abs(ink.y - cy) < 6,
        `the ink sits where it was drawn: ${JSON.stringify(ink)}`,
      )

      await frame.locator("dialog.cz-dialog").press("Escape")
      await frame.locator("dialog.cz-dialog").waitFor({ state: "detached" })
      assert.equal(await hostParent(frame), "html", "the layer returns to the page")

      await setTool(page, "comment")
      const onPage = await drag(page, await frame.locator("article p").first().boundingBox())
      assert.notEqual(onPage.kind, "image")
      assert.match(onPage.selector, /^body > main > article/, "the area anchors to the doc, not to the zoom")
    } finally {
      await browser.close()
    }
  }, 60_000)
}
