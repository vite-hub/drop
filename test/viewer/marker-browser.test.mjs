import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// An HTML doc with a tooltip that only shows on hover, the case the Marker freezes the page for.
const html = `<!doctype html><html><head><style>
  body { margin: 0; padding: 40px; font: 16px/1.5 sans-serif; }
  .wrap { position: relative; display: inline-block; }
  .tip { display: none; position: absolute; left: 0; top: 100%; width: 520px; padding: 12px; border: 1px solid #ddd; background: #fff; }
  .wrap:hover .tip { display: block; }
</style></head><body>
  <span class="wrap"><span class="metric">8.4× average demand line</span>
    <span class="tip"><p class="note">The average per demand line. Not monthly demand.</p></span></span>
</body></html>`

// The screenshot module, stubbed: a white viewport, so the test needs no network and the strokes are all that's drawn.
const SCREENSHOT_STUB = `export async function createContext() { return {}; }
export async function domToBlob() {
  if (self.delayCaptures) await new Promise((resolve) => (self.pendingCaptures ||= []).push(resolve));
  const canvas = document.createElement("canvas");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}`

async function open(browser, source = html) {
  const escaped = planDocument("html", source).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: SCREENSHOT_STUB,
      })
    if (url.hostname !== "drop.test") return route.abort()
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
          window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return { context, page, frame: page.frames()[1] }
}

const posted = (page, type) =>
  page.evaluate(
    (type) =>
      window.posts
        .filter((m) => m.type === type)
        .map(({ image, ...rest }) => ({ ...rest, image: image ? { type: image.type, size: image.size } : null })),
    type,
  )

test("the Marker keeps a hovered tooltip open, reads the words under a stroke, and sends the snapshot", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    const metric = await frame.locator(".metric").boundingBox()
    await page.mouse.move(metric.x + 20, metric.y + metric.height / 2)
    await frame.locator(".tip").waitFor({ state: "visible" })
    await page.evaluate(() =>
      tell({ type: "tool", tool: "mark", pen: { tool: "marker", color: "#ec4899", width: 14 } }),
    )
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))

    // The pointer leaves the trigger to draw, and the tooltip stays.
    const words = await frame.locator(".note").evaluate((el) => {
      const text = el.firstChild,
        range = document.createRange(),
        at = text.data.indexOf("Not monthly")
      range.setStart(text, at)
      range.setEnd(text, text.data.length)
      const r = [...range.getClientRects()].at(-1)
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    await page.mouse.move(words.x + 1, words.y + words.height / 2)
    await page.mouse.down()
    await page.mouse.move(words.x + words.width - 1, words.y + words.height / 2, { steps: 10 })
    await page.mouse.up()
    assert.equal(await frame.locator(".tip").isVisible(), true)
    assert.deepEqual((await posted(page, "marks")).at(-1), { type: "marks", count: 1, __drop: true, image: null })

    await page.evaluate(() => tell({ type: "mark", do: "done" }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "area"))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "area-shot"))
    const [area] = await posted(page, "area")
    assert.match(area.quote, /Not monthly demand\./)
    assert.doesNotMatch(area.quote, /average per/)
    // The picture follows as the area's "area-shot", which Drop adds to the comment.
    const [shot] = await page.evaluate(() =>
      window.posts
        .filter((m) => m.type === "area-shot")
        .map((m) => ({ shot: m.shot, type: m.image?.type, size: m.image?.size })),
    )
    assert.equal(shot.shot, area.shot)
    assert.equal(shot.type, "image/webp")
    assert.ok(shot.size > 0)
    assert.ok(area.ow > 0 && area.oh > 0 && area.ox + area.ow <= 1000 && area.oy + area.oh <= 1000)
    // The stroke stays on the page while the comment is written.
    assert.equal(
      await frame.evaluate(
        () => document.querySelectorAll("drop-comments")[0].shadowRoot.querySelectorAll(".draft .inkp path").length,
      ),
      1,
    )

    // Back to Browse, the page unfreezes: the tooltip goes with the pointer again.
    await page.evaluate(() => tell({ type: "tool", tool: "browse" }))
    await frame.waitForFunction(() => !document.querySelector("[data-drop-hover]"))
    await page.mouse.move(800, 500)
    await frame.locator(".tip").waitFor({ state: "hidden" })
  } finally {
    await browser.close()
  }
})

test("Escape under the Marker goes to Drop, and an undone stroke leaves nothing to send", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    // The page has focus, as after pressing B in it.
    await page.mouse.click(600, 500)
    await page.evaluate(() => tell({ type: "tool", tool: "mark", pen: { tool: "arrow", color: "#2563eb", width: 3 } }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))
    await page.mouse.move(400, 400)
    await page.mouse.down()
    await page.mouse.move(200, 200, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.posts.findLast((m) => m.type === "marks")?.count === 1)
    await page.keyboard.press("Control+z")
    await page.waitForFunction(() => window.posts.findLast((m) => m.type === "marks")?.count === 0)
    await page.keyboard.press("Enter")
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => window.posts.some((m) => m.type === "key" && m.key === "Escape"))
    assert.equal((await posted(page, "area")).length, 0)
  } finally {
    await browser.close()
  }
})

for (const adopted of [false, true]) {
  test(`the Marker freezes nested open shadow roots with ${adopted ? "adopted" : "inline"} hover styles`, async () => {
    const browser = await chromium.launch()
    try {
      const { page, frame } = await open(
        browser,
        `<!doctype html><body><outer-widget></outer-widget><script>
        const outer = document.querySelector("outer-widget").attachShadow({ mode: "open" });
        outer.innerHTML = '<inner-widget></inner-widget>';
        const root = outer.querySelector("inner-widget").attachShadow({ mode: "open" });
        root.innerHTML = '<style>.tip { display: none } .metric { display: block; width: 200px; padding: 40px }</style><div class="wrap"><span class="metric">Hover me</span><span class="tip">Shadow tooltip</span></div>';
        const css = '.wrap:hover .tip { display: block }';
        if (${adopted}) {
          const sheet = new CSSStyleSheet(); sheet.replaceSync(css); root.adoptedStyleSheets = [sheet];
        } else {
          const style = document.createElement("style"); style.textContent = css; root.appendChild(style);
        }
      </script></body>`,
      )
      await frame.locator(".metric").hover()
      await frame.locator(".tip").waitFor({ state: "visible" })
      const stylesBefore = await frame
        .locator(".tip")
        .evaluate((el) => el.getRootNode().querySelectorAll("style").length)
      await page.evaluate(() => tell({ type: "tool", tool: "mark" }))
      await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))
      await page.mouse.move(800, 500)
      assert.equal(await frame.locator(".tip").isVisible(), true)
      await page.evaluate(() => tell({ type: "tool", tool: "browse" }))
      await frame.locator(".tip").waitFor({ state: "hidden" })
      assert.deepEqual(
        await frame.locator(".tip").evaluate((el) => ({
          hovering: el.getRootNode().querySelectorAll("[data-drop-hover]").length,
          styles: el.getRootNode().querySelectorAll("style").length,
        })),
        { hovering: 0, styles: stylesBefore },
      )
    } finally {
      await browser.close()
    }
  })
}

test("a finished bowed arrow anchors and persists its complete rendered bounds", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(
      browser,
      `<!doctype html><style>
      body { margin: 0 } #wide { position: absolute; left: 80px; top: 80px; width: 700px; height: 300px }
      #tight { position: absolute; left: 120px; top: 120px; width: 380px; height: 8px }
    </style><main id="wide"><div id="tight"></div></main>`,
    )
    await page.evaluate(() => tell({ type: "tool", tool: "mark", pen: { tool: "arrow", color: "#2563eb", width: 3 } }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))
    await page.mouse.move(210, 204)
    await page.mouse.down()
    await page.mouse.move(570, 204, { steps: 6 })
    await page.mouse.up()
    const visible = await frame.evaluate(() => {
      const path = document.querySelector("drop-comments").shadowRoot.querySelector(".ink path")
      const box = path.getBBox(),
        radius = Number(path.getAttribute("stroke-width")) / 2
      return {
        left: box.x - radius,
        right: box.x + box.width + radius,
        top: box.y - radius,
        bottom: box.y + box.height + radius,
      }
    })
    await page.evaluate(() => tell({ type: "mark", do: "done" }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "area"))
    const [area] = await posted(page, "area")
    assert.equal(area.selector, "#wide")
    const saved = await frame.locator(area.selector).evaluate((el, area) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left + (r.width * area.ox) / 1000,
        right: r.left + (r.width * (area.ox + area.ow)) / 1000,
        top: r.top + (r.height * area.oy) / 1000,
        bottom: r.top + (r.height * (area.oy + area.oh)) / 1000,
      }
    }, area)
    for (const bounds of [area.rect, saved]) {
      assert.ok(bounds.left <= visible.left && bounds.right >= visible.right, JSON.stringify({ bounds, visible }))
      assert.ok(bounds.top <= visible.top && bounds.bottom >= visible.bottom, JSON.stringify({ bounds, visible }))
    }
  } finally {
    await browser.close()
  }
})

test("keyboard scrolling stays locked under the Marker and resumes in Browse", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(
      browser,
      "<!doctype html><style>body { height: 3000px }</style><p>Scrollable page</p>",
    )
    await page.mouse.click(600, 400)
    await frame.evaluate(() => scrollTo(0, 100))
    await page.evaluate(() => tell({ type: "tool", tool: "mark" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))
    for (const key of ["PageDown", "Space", "ArrowDown", "End", "PageUp", "ArrowUp", "Home"])
      await page.keyboard.press(key)
    await page.waitForTimeout(250)
    assert.equal(await frame.evaluate(() => scrollY), 100)
    await page.evaluate(() => tell({ type: "tool", tool: "browse" }))
    await frame.waitForFunction(() => !document.querySelector("[data-drop-hover]"))
    await page.keyboard.press("End")
    await frame.waitForFunction(() => scrollY > 100)
  } finally {
    await browser.close()
  }
})

test("a canceled capture cannot post over or unlock a new Marker session", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await frame.evaluate(() => {
      self.delayCaptures = true
    })
    const draw = async (y) => {
      await page.mouse.move(200, y)
      await page.mouse.down()
      await page.mouse.move(400, y, { steps: 4 })
      await page.mouse.up()
    }
    await page.evaluate(() => tell({ type: "tool", tool: "mark" }))
    await frame.waitForFunction(() => self.pendingCaptures?.length === 1)
    await draw(300)
    await page.evaluate(() => tell({ type: "mark", do: "done" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draft .inkp"))
    await page.evaluate(() => {
      tell({ type: "tool", tool: "browse" })
      tell({ type: "clear-area" })
      tell({ type: "tool", tool: "mark" })
    })
    await frame.waitForFunction(() => self.pendingCaptures?.length === 2)
    await draw(400)
    await page.evaluate(() => tell({ type: "mark", do: "done" }))
    await frame.evaluate(() => self.pendingCaptures[0]())
    await page.waitForTimeout(150)
    assert.equal((await posted(page, "area")).length, 0)
    // The old completion must leave the current preview and in-flight Done alone.
    assert.equal(
      await frame.evaluate(
        () => document.querySelector("drop-comments").shadowRoot.querySelectorAll(".draft .inkp path").length,
      ),
      1,
    )
    await page.evaluate(() => tell({ type: "mark", do: "done" }))
    await frame.evaluate(() => self.pendingCaptures[1]())
    await page.waitForFunction(() => window.posts.some((m) => m.type === "area-shot"))
    const areas = await posted(page, "area")
    assert.equal(areas.length, 1)
    assert.ok(areas[0].rect.top > 380)
  } finally {
    await browser.close()
  }
})
