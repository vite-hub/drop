import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { migrate } from "../cost/harness.mjs"
import { renderMarkdownCached } from "../../server/utils/markdown-document.ts"

migrate()

test("zoomed screenshots copy from the header and follow gallery navigation", async () => {
  const image = (color) =>
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="${color}"/></svg>`,
    )
  const markdown = `::compare
:::screenshot{src="${image("#ed2020")}" alt="Before screenshot" title="Before"}
::::annotation{x=5 y=5 w=20 h=20}
Before note.
::::
:::
:::screenshot{src="${image("#2020ed")}" alt="After screenshot" title="After"}
::::annotation{x=65 y=5 w=20 h=20}
After note.
::::
:::
::`
  const { html } = await renderMarkdownCached("screenshot-zoom.md", async () => markdown)
  const styles = await Promise.all(
    ["typeset.css", "document-shell.css"].map((file) =>
      readFile(new URL("../../shared/" + file, import.meta.url), "utf8"),
    ),
  )
  const document = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.join("\n")}</style></head><body><main><article class="typeset">${html}</article></main></body></html>`
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
    })
    await context.route("https://zoom.test/", (route) => route.fulfill({ contentType: "text/html", body: document }))
    const page = await context.newPage()
    await page.goto("https://zoom.test/")
    assert.equal(await page.locator(".ca-frame > .ca-copy").count(), 2)
    await page.locator(".ca-screenshot [data-zoom]").last().click()
    const headerCopy = page.locator(".cz-header").getByRole("button", { name: "Copy the screenshot with its marks" })
    await headerCopy.waitFor({ state: "visible" })
    assert.equal(await page.locator(".cz-item .ca-copy, .cz-thumb .ca-copy").count(), 0)
    const position = await page.locator(".cz-dialog").evaluate((dialog) => ({
      copyBottom: dialog.querySelector(".ca-copy").getBoundingClientRect().bottom,
      imageTop: dialog.querySelector(".ca-frame img").getBoundingClientRect().top,
      beforeClose: Boolean(dialog.querySelector(".ca-zoom-copy + .cz-close")),
    }))
    assert.ok(position.beforeClose && position.copyBottom <= position.imageTop)

    const copiedColor = async () => {
      const [item] = await navigator.clipboard.read()
      const bitmap = await createImageBitmap(await item.getType("image/png"))
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext("2d")
      ctx.drawImage(bitmap, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0,
        blue = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 2] < 80) red++
        if (pixels[i + 2] > 200 && pixels[i] < 80) blue++
      }
      return { red, blue }
    }
    await headerCopy.focus()
    await page.keyboard.press("Enter")
    await page.locator(".cz-header .ca-copy[data-state=done]").waitFor()
    const after = await page.evaluate(copiedColor)
    assert.ok(after.blue > 100 && after.red === 0, "copy uses the active After screenshot")

    await page.getByRole("button", { name: "Previous", exact: true }).click()
    assert.equal(await page.locator(".cz-title").textContent(), "Before")
    assert.equal(await headerCopy.count(), 1)
    assert.equal(await page.locator(".cz-header .ca-copy[data-state]").count(), 0)
    await page.locator(".cz-dialog").focus()
    await page.keyboard.press("Control+c")
    await page.locator(".cz-header .ca-copy[data-state=done]").waitFor()
    const before = await page.evaluate(copiedColor)
    assert.ok(before.red > 100 && before.blue === 0, "the shortcut follows the active Before screenshot")

    await page.keyboard.press("Escape")
    await page.locator(".cz-dialog").waitFor({ state: "detached" })
    assert.equal(
      await page.locator(".ca-frame > .ca-copy").count(),
      2,
      "inline controls retain their original position",
    )

    const phone = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true })
    await phone.route("https://zoom.test/", (route) => route.fulfill({ contentType: "text/html", body: document }))
    const touch = await phone.newPage()
    await touch.goto("https://zoom.test/")
    await touch.locator(".ca-screenshot [data-zoom]").last().tap()
    const box = await touch.locator(".cz-header .ca-copy").boundingBox()
    assert.ok(box.width >= 44 && box.height >= 44)
    assert.equal(await touch.locator(".cz-item .ca-copy").count(), 0)
    await phone.close()
  } finally {
    await browser.close()
  }
}, 30_000)
