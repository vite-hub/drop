import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"

test("a linked badge has a pointer and follows its link while unlinked images still zoom", async () => {
  const badge = "https://badges.test/badge.svg?label=contributions&value=prs.onmax.me&icon=github"
  const destination = "https://prs.test/"
  const document = injectRuntime(
    `<!doctype html><html><head></head><body>
      <a href="${destination}"><img src="${badge}" alt="Contributions: prs.onmax.me"></a>
      <img src="${badge}" alt="Unlinked image">
    </body></html>`,
    false,
  )
  const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === "drop.test")
        return route.fulfill({
          contentType: "text/html",
          body: `<iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
            <script>window.images = []; addEventListener("message", e => {
              if (e.data?.__drop && e.data.type === "image") window.images.push(e.data);
            });</script>`,
        })
      if (url.hostname === "badges.test")
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="199" height="26"><rect width="199" height="26"/></svg>',
        })
      if (url.hostname === "prs.test") return route.fulfill({ contentType: "text/html", body: "Contributions" })
      return route.abort()
    })
    const page = await context.newPage()
    await page.goto("https://drop.test/doc")
    const frame = page.frameLocator("iframe")
    const linked = frame.getByRole("img", { name: "Contributions: prs.onmax.me", exact: true })
    await linked.hover()
    assert.equal(await linked.evaluate((img) => getComputedStyle(img).cursor), "pointer")
    const popup = page.waitForEvent("popup")
    await linked.click()
    const opened = await popup
    await opened.waitForURL(destination)
    assert.equal(await page.evaluate(() => window.images.length), 0, "linked images do not open the lightbox")
    await opened.close()

    const unlinked = frame.getByRole("img", { name: "Unlinked image", exact: true })
    await unlinked.hover()
    assert.equal(await unlinked.evaluate((img) => getComputedStyle(img).cursor), "zoom-in")
    await unlinked.click()
    await page.waitForFunction(() => window.images.length === 1)
    assert.equal(await page.evaluate(() => window.images[0].alt), "Unlinked image")
  } finally {
    await browser.close()
  }
})
