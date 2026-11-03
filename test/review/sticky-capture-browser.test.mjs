import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"
import { CAPTURE } from "../../shared/viewport-capture.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"
const require = createRequire(import.meta.url)
const { version } = require("modern-screenshot/package.json")
// The module review.js loads from esm.sh, from node_modules, so the screenshot is drawn as it is on a reviewer's page.
const SCREENSHOT_MODULE = readFileSync(new URL(import.meta.resolve("modern-screenshot")), "utf8")

// Quiver's product page (portal#1102): the app is a fixed shell that scrolls inside, and the product bar is a
// zero-height sticky wrapper (Tailwind's sticky top-12 z-20 h-0) whose bar overflows it, shown once the page scrolls.
const html = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px/1.4 sans-serif; }
  .shell { position: fixed; inset: 0; display: flex; }
  .scroll { flex: 1; overflow-y: auto; }
  .title { height: 260px; }
  .stick { position: sticky; top: 48px; z-index: 20; height: 0; }
  .product-bar { display: flex; justify-content: space-between; padding: 8px 24px; background: rgb(255 0 170 / .95); }
  .content { height: 3000px; background: rgb(0 120 255); }
</style></head><body><div class="shell"><div class="scroll">
  <header class="title">288679 Combo</header>
  <div class="stick"><div class="product-bar"><b>288679 Combo</b><span>12,400 on hand</span></div></div>
  <div class="content"></div>
</div></div><script src="${DROP}/review.js" defer></script></body></html>`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

test("review.js loads the modern-screenshot this test draws with", () => {
  assert.match(REVIEW_SCRIPT, new RegExp(`esm\\.sh/modern-screenshot@${version.replaceAll(".", "\\.")}"`))
})

test("a box on a zero-height sticky bar gets the bar in its screenshot, and names it with the CSS that pins it", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } })
    await context.addInitScript(
      ({ drop }) => {
        const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
        Element.prototype.attachShadow = function (init) {
          return Reflect.apply(attach, this, [{ ...init, mode: "open" }])
        }
        sessionStorage.setItem(
          "drop-review:" + drop,
          JSON.stringify({ token: "t", expiresAt: Date.now() + 3600_000, name: "Ada" }),
        )
        window.sent = []
        const send = window.fetch
        window.fetch = (url, init) => {
          if (init && init.body instanceof FormData) window.sent.push(init.body)
          return send(url, init)
        }
      },
      { drop: DROP },
    )
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === "esm.sh")
        return route.fulfill({
          contentType: "text/javascript",
          headers: { "access-control-allow-origin": "*" },
          body: SCREENSHOT_MODULE,
        })
      if (url.origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
      if (url.origin !== DROP) return route.abort()
      if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
      const body = route.request().method() === "POST" ? { n: 1 } : { threads: [] }
      return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(body) })
    })
    const page = await context.newPage()
    await page.goto(SITE + "/product")
    const ui = page.locator("drop-review")
    await ui.getByRole("button", { name: "Comment" }).first().waitFor()
    await page.evaluate(() => {
      document.querySelector(".scroll").scrollTop = 600
    })
    const bar = await page.locator(".product-bar").boundingBox()
    assert.equal(Math.round(bar.y), 48, "the bar sticks under the top")

    // A box taller than the bar, over its right half: nothing around the bar holds it but the page.
    await ui.getByRole("button", { name: "Comment" }).first().click()
    const from = [bar.x + bar.width * 0.6, bar.y - 30]
    const to = [bar.x + bar.width * 0.9, bar.y + bar.height + 60]
    await page.mouse.move(...from)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
    await page.mouse.up()
    const note = ui.locator("textarea:visible").first()
    await note.waitFor()
    await note.fill("Padding top")
    await ui.getByRole("button", { name: "Send" }).first().click()
    await page.waitForFunction(() => window.sent.length === 1, null, { timeout: 30_000 })

    const sent = await page.evaluate(
      async (points) => {
        const form = window.sent[0]
        const data = JSON.parse(form.get("data"))
        const image = await createImageBitmap(form.get("screenshot"))
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext("2d")
        g.drawImage(image, 0, 0)
        const k = image.width / innerWidth
        return {
          data,
          size: [image.width, image.height],
          marked: document.querySelector(data.selector) === document.querySelector(".product-bar"),
          under: points.map(([x, y]) => Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data)),
        }
      },
      [
        [bar.x + bar.width * 0.4, bar.y + bar.height / 2],
        [bar.x + bar.width * 0.4, bar.y + bar.height + 20],
      ],
    )
    assert.deepEqual(sent.size, [1200, 700])
    const [onBar] = sent.under
    assert.ok(onBar[0] > 200 && onBar[1] < 80 && onBar[2] > 120, `the bar is where the reviewer saw it, got ${onBar}`)
    assert.equal(sent.marked, true, `the comment names the bar, not the page around it: ${sent.data.selector}`)
    assert.equal(
      sent.data.label,
      'div "288679 Combo 12,400 on hand" in a sticky element (its parent: top: 48px; z-index: 20; height: 0)',
      "the fixed shell that fills the window isn't what the box is on",
    )
  } finally {
    await browser.close()
  }
})

for (const rendering of ["shadow root", "pseudo-element"]) {
  for (const position of ["sticky", "fixed"]) {
    test(`a zero-height ${position} wrapper preserves its ${rendering} bar in the screenshot`, async () => {
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
        await page.route("**/*", (route) =>
          route.fulfill(
            new URL(route.request().url()).hostname === "esm.sh"
              ? {
                  contentType: "text/javascript",
                  headers: { "access-control-allow-origin": "*" },
                  body: SCREENSHOT_MODULE,
                }
              : {
                  contentType: "text/html; charset=utf-8",
                  body: html.replace(`<script src="${DROP}/review.js" defer></script>`, ""),
                },
          ),
        )
        await page.goto(SITE + "/product")
        await page.evaluate(
          ({ rendering, position }) => {
            const host = document.querySelector(".stick")
            host.replaceChildren()
            host.style.position = position
            if (position === "fixed") host.style.cssText += ";left:0;right:0"
            const barStyle = "display:block;height:40px;background:rgb(255 0 170)"
            if (rendering === "shadow root") {
              host.attachShadow({ mode: "open" }).innerHTML = `<div style="${barStyle}"></div>`
            } else {
              const style = document.createElement("style")
              style.textContent = `.stick::before { content: ""; ${barStyle} }`
              document.head.appendChild(style)
            }
            document.querySelector(".scroll").scrollTop = 600
          },
          { rendering, position },
        )
        await page.addScriptTag({ content: CAPTURE + "\nwindow.captureViewport = captureViewport;" })
        const pixels = await page.evaluate(async () => {
          const host = document.querySelector(".stick")
          const rect = host.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(host)
          const content = range.getBoundingClientRect()
          const shot = await window.captureViewport(null)
          const image = await createImageBitmap(shot)
          const canvas = document.createElement("canvas")
          canvas.width = image.width
          canvas.height = image.height
          const g = canvas.getContext("2d")
          g.drawImage(image, 0, 0)
          const k = image.width / innerWidth
          const pixel = (y) => Array.from(g.getImageData(Math.round(480 * k), Math.round(y * k), 1, 1).data)
          return {
            top: rect.top,
            height: rect.height,
            contentSize: [content.width, content.height],
            onBar: pixel(68),
            below: pixel(108),
          }
        })
        assert.equal(pixels.top, 48)
        assert.equal(pixels.height, 0)
        assert.deepEqual(pixels.contentSize, [0, 0], "a light-DOM range cannot measure this bar")
        assert.ok(
          pixels.onBar[0] > 200 && pixels.onBar[1] < 80 && pixels.onBar[2] > 120,
          `the bar is where the reviewer saw it, got ${pixels.onBar}`,
        )
        assert.ok(pixels.below[0] < 40 && pixels.below[2] > 200, `the page stays below the bar, got ${pixels.below}`)
      } finally {
        await browser.close()
      }
    })
  }
}

for (const transforms of ["transform:rotate(-90deg)", "rotate:-90deg;translate:20px 20px;scale:1.5"]) {
  test(`an offscreen zero-size fixed host preserves its transformed overflow (${transforms})`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
      await page.route("**/*", (route) =>
        route.fulfill(
          new URL(route.request().url()).hostname === "esm.sh"
            ? {
                contentType: "text/javascript",
                headers: { "access-control-allow-origin": "*" },
                body: SCREENSHOT_MODULE,
              }
            : {
                contentType: "text/html; charset=utf-8",
                body: html.replace(`<script src="${DROP}/review.js" defer></script>`, ""),
              },
        ),
      )
      await page.goto(SITE + "/product")
      await page.evaluate((transforms) => {
        const host = document.createElement("div")
        host.style.cssText = `position:fixed;left:-100px;top:200px;width:0;height:0;${transforms}`
        host.innerHTML = '<div id="transformed-bar" style="width:40px;height:300px;background:rgb(255 0 170)"></div>'
        document.body.appendChild(host)
        document.querySelector(".scroll").scrollTop = 600
      }, transforms)
      await page.addScriptTag({ content: CAPTURE + "\nwindow.captureViewport = captureViewport;" })
      const pixels = await page.evaluate(async () => {
        const bar = document.querySelector("#transformed-bar")
        const host = bar.parentElement
        const rect = host.getBoundingClientRect()
        const before = host.getAttribute("style")
        const barRect = bar.getBoundingClientRect()
        const x = Math.max(0, barRect.left) + (Math.min(innerWidth, barRect.right) - Math.max(0, barRect.left)) / 2
        const y = barRect.top + barRect.height / 2
        const shot = await window.captureViewport(null)
        const image = await createImageBitmap(shot)
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext("2d")
        g.drawImage(image, 0, 0)
        const k = image.width / innerWidth
        const pixel = (y) => Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data)
        return {
          hostSize: [rect.width, rect.height],
          hostRight: rect.right,
          live: document.elementFromPoint(x, y) === bar,
          restored: host.getAttribute("style") === before,
          onBar: pixel(y),
          below: pixel(barRect.bottom + 20),
        }
      })
      assert.deepEqual(pixels.hostSize, [0, 0])
      assert.ok(pixels.hostRight < 0, "the host's own rect is offscreen")
      assert.equal(pixels.live, true, "the transform brings the overflowing bar into view")
      assert.equal(pixels.restored, true, "capture restores the live host's inline styles")
      assert.ok(
        pixels.onBar[0] > 200 && pixels.onBar[1] < 80 && pixels.onBar[2] > 120,
        `the bar keeps its rendered geometry, got ${pixels.onBar}`,
      )
      assert.ok(pixels.below[0] < 40 && pixels.below[2] > 200, `the page stays below the bar, got ${pixels.below}`)
    } finally {
      await browser.close()
    }
  })
}
