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

:::screenshot{src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#16a34a"/></svg>')}" alt="Billing page" title="Billing"}
::::annotation{x=5 y=5 w=20 h=20}
Another note.
::::
:::
`

async function open(browser, html, image) {
  const escaped = planDocument("markdown", "", false, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  if (image) await page.route(image.url, (route) => route.fulfill({ contentType: "image/svg+xml", body: image.svg }))
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

test("table thumbnails preserve old pins and anchor new Marker ink to the source image", async () => {
  const image = {
    url: "https://drop.test/thumbnail.svg",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="blue"/></svg>',
  }
  const table = `| Component name | Target hostname | Deployment stage | Approval status | Shot |
| --- | --- | --- | --- | --- |
| web | staging | canary | ready | ![Dashboard](${image.url}) |
`
  const { html } = await renderMarkdownCached("thumbnail-comments.md", async () => table)
  assert.match(html, /<div\s+data-wide(?:\s|=)[^>]*>\s*<table/)
  assert.match(html, /<img(?=[^>]+data-zoom-thumb)(?=[^>]+alt="Dashboard")/)
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, html, image)
    const thumbnail = frame.locator('article > div[data-wide] > table img[data-zoom][alt="Dashboard"]')
    await thumbnail.waitFor()
    const legacy = "body > main > article > table > tbody > tr > td:nth-of-type(5) > img"
    assert.equal(await frame.locator(legacy).count(), 0)
    const marker = { n: 1, author: "A B", ox: 450, oy: 450, ow: 100, oh: 100 }
    const showMarkers = (markers) => page.evaluate((markers) => send({ type: "markers", markers }), markers)
    await page.evaluate(() => send({ type: "view", pins: true, style: "pin" }))
    await showMarkers([
      { ...marker, id: "legacy-image", kind: "image", selector: legacy, label: "Dashboard" },
      { ...marker, id: "legacy-area", kind: "area", selector: legacy, label: 'img "Dashboard"' },
    ])
    for (const id of ["legacy-image", "legacy-area"]) {
      await frame.locator(`[data-slot="comment-mark-pin"][data-id="${id}"]`).waitFor()
    }

    await thumbnail.press("Enter")
    const dialog = frame.locator("dialog.cz-dialog")
    const zoomed = dialog.locator('.cz-item img[alt="Dashboard"]')
    await zoomed.waitFor()
    await setTool(page, "mark")
    const box = await zoomed.boundingBox()
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(center.x - 25, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + 25, center.y, { steps: 10 })
    await page.mouse.up()
    await page.evaluate(() => send({ type: "mark", do: "done" }))
    const area = await (await page.waitForFunction(() => posts.find((message) => message.type === "area"))).jsonValue()
    assert.ok(area.ink)
    assert.ok(await thumbnail.evaluate((img, selector) => document.querySelector(selector) === img, area.selector))
    assert.ok(Math.abs(area.ox + area.ow / 2 - 500) < 30)
    assert.ok(Math.abs(area.oy + area.oh / 2 - 500) < 30)
    await setTool(page, "browse")
    await dialog.press("Escape")
    await dialog.waitFor({ state: "detached" })
    await showMarkers([{ ...marker, ...area, id: "new-ink", kind: "area" }])
    const pin = frame.locator('[data-slot="comment-mark-pin"][data-id="new-ink"]')
    await pin.waitFor()
    await thumbnail.press("Enter")
    await dialog.locator('[data-slot="comment-mark-pin"][data-id="new-ink"]').waitFor()
  } finally {
    await browser.close()
  }
}, 60_000)

for (const [name, engine] of [
  ["Chromium", chromium],
  ["Firefox", firefox],
]) {
  test(`a comment lands on a zoomed screenshot, and on the page after the zoom closes (${name})`, async () => {
    const { html } = await renderMarkdownCached("zoom-comments.md", async () => markdown)
    const browser = await engine.launch()
    try {
      const { page, frame } = await open(browser, html)
      await frame.locator(".ca-screenshot [data-zoom]").first().click()
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

      // The ink belongs to its screenshot: moving to the next one in the zoom hides it, and coming back shows it again.
      const inkShown = () =>
        frame.evaluate(() => {
          const svg = [...document.querySelectorAll("drop-comments")]
            .find((h) => h.style.zIndex)
            .shadowRoot.querySelector(".draft .inkp")
          return getComputedStyle(svg).display !== "none"
        })
      await frame.evaluate(() => {
        window.zoomed = []
        document.addEventListener("comark-zoom:change", (e) =>
          window.zoomed.push((e.detail.item.matches("img") ? e.detail.item : e.detail.item.querySelector("img"))?.alt),
        )
      })
      await page.keyboard.press("ArrowDown")
      await frame.waitForFunction(() => window.zoomed.at(-1) === "Billing page")
      assert.equal(await inkShown(), false, "not on the next screenshot")
      await page.keyboard.press("ArrowUp")
      await frame.waitForFunction(() => window.zoomed.at(-1) === "Settings page")
      assert.equal(await inkShown(), true, "back on its own screenshot")

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
