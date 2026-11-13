import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"

const html = `<!doctype html><html><head><style>
  body { margin: 0; padding: 40px; font: 16px/1.5 sans-serif; height: 3000px; }
</style></head><body>
  <h1 id="price">Pro costs 12 € a month</h1>
  <p>Billed yearly.</p>
  <script src="${DROP}/review.js" defer></script>
</body></html>`

// The screenshot module, stubbed: a white viewport, so the test needs no network and the strokes are all that's drawn.
const SCREENSHOT_STUB = `export async function createContext() { return {}; }
export async function domToCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  // The toolbar's shadow root is closed; opened here so the test can reach its buttons. A connected reviewer, and every
  // form the script sends, kept for the test to read.
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
      window.pageKeys = []
      addEventListener("keydown", (e) => window.pageKeys.push(e.key))
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
        body: SCREENSHOT_STUB,
      })
    if (url.origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().method() === "POST" ? { n: 1 } : { threads: [] }
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(body) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/pricing")
  await page.locator("drop-review").getByRole("button", { name: "Highlight" }).waitFor()
  return { context, page, ui: page.locator("drop-review") }
}

async function drag(page, from, to) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
  await page.mouse.up()
}

test("comment composers tab in reading order, images to Send, and send with the keyboard", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    const comment = ui.getByRole("button", { name: "Comment", exact: true })
    const note = ui.getByRole("textbox", { name: "Comment" })
    const focused = (locator) => locator.evaluate((node) => node.getRootNode().activeElement === node)

    await comment.click()
    await page.mouse.click(100, 100)
    await note.fill("Remove this option")
    await page.keyboard.press("Enter")
    assert.equal(await note.inputValue(), "Remove this option\n")
    assert.equal(await page.evaluate(() => window.sent.length), 0)
    // The footer reads left to right: images, Cancel, then Send last, where the eye ends.
    await page.keyboard.press("Tab")
    assert.equal(await focused(ui.getByRole("button", { name: "Add images" })), true)
    await page.keyboard.press("Tab")
    assert.equal(await focused(ui.getByRole("button", { name: "Cancel", exact: true })), true)
    await page.keyboard.press("Tab")
    assert.equal(await focused(ui.getByRole("button", { name: "Send", exact: true })), true)
    assert.match(await ui.locator(".pop [type=submit]").getAttribute("title"), /Send \((⌘|Ctrl\+)Enter\)/)
    assert.equal(await ui.locator(".pop .shortcut").count(), 0)
    await page.keyboard.press("Escape")
    assert.equal(await focused(comment), true)

    for (const [index, key] of ["Enter", "Meta+Enter", "Control+Enter"].entries()) {
      await comment.click()
      await page.mouse.click(100, 100)
      await note.fill("Remove this option")
      await note.dispatchEvent("keydown", { key: "Enter", metaKey: true, isComposing: true })
      assert.equal(await page.evaluate(() => window.sent.length), index)
      if (key === "Enter") await ui.getByRole("button", { name: "Send", exact: true }).focus()
      await page.keyboard.press(key)
      await page.waitForFunction((count) => window.sent.length === count, index + 1)
      await ui.locator(".pop").waitFor({ state: "hidden" })
      assert.equal(await focused(comment), true)
    }
  } finally {
    await browser.close()
  }
})

test("Highlight draws on the page and sends the screenshot with the strokes, anchored to what's under them", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await ui.getByRole("button", { name: "Highlight" }).click()
    const done = ui.getByRole("button", { name: "Done" })
    assert.equal(await done.isDisabled(), true, "nothing to send before a stroke")
    assert.equal(await ui.getByRole("button", { name: "Marker" }).getAttribute("aria-pressed"), "true")

    const box = await page.locator("#price").boundingBox()
    const y = box.y + box.height / 2
    await drag(page, [box.x + 10, y], [box.x + 200, y])
    // A tip's key is Highlight's, not the page's.
    await page.keyboard.press("a")
    assert.equal(await ui.getByRole("button", { name: "Arrow" }).getAttribute("aria-pressed"), "true")
    assert.deepEqual(await page.evaluate(() => window.pageKeys), [])
    // The page holds still under the strokes.
    await page.mouse.wheel(0, 400)
    assert.equal(await page.evaluate(() => scrollY), 0)

    await done.click()
    const note = ui.getByRole("textbox", { name: "Comment" })
    await note.waitFor()
    assert.equal(await ui.locator(".ink path").count(), 1, "the strokes stay while the note is written")
    await note.fill("Should be 10 €")
    await ui.getByRole("button", { name: "Send" }).click()
    await page.waitForFunction(() => window.sent.length === 1)

    const sent = await page.evaluate(
      async ([x, y]) => {
        const form = window.sent[0]
        const shot = form.get("screenshot")
        const image = await createImageBitmap(shot)
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext("2d")
        g.drawImage(image, 0, 0)
        const k = image.width / innerWidth
        return {
          data: JSON.parse(form.get("data")),
          type: shot.type,
          under: Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data),
          away: Array.from(g.getImageData(5, 5, 1, 1).data),
        }
      },
      [box.x + 100, y],
    )
    assert.equal(sent.data.body, "Should be 10 €")
    assert.equal(sent.data.selector, "#price")
    assert.match(sent.data.label, /^h1 "Pro costs/)
    assert.ok(sent.data.ow > 0 && sent.data.oh > 0)
    assert.match(sent.type, /^image\/(webp|jpeg)$/)
    // The marker's pink, multiplied onto the white page, under the stroke; the rest stays white.
    assert.ok(sent.under[1] < 215 && sent.under[0] > 230, `pink under the marker, got ${sent.under}`)
    assert.deepEqual(sent.away.slice(0, 3), [255, 255, 255])
    assert.equal(await ui.locator(".ink path").count(), 0, "sending clears the strokes")
    assert.equal(await ui.getByRole("button", { name: "Highlight" }).isVisible(), true)
  } finally {
    await browser.close()
  }
})

test("Highlight blocks keyboard scrolling and page shortcuts until canceled", async () => {
  const browser = await chromium.launch({ args: ["--disable-smooth-scrolling"] })
  try {
    const { page, ui } = await open(browser)
    await page.evaluate(() => {
      document.body.style.width = "1800px"
      document.body.tabIndex = -1
      scrollTo(100, 400)
    })
    await ui.getByRole("button", { name: "Highlight" }).click()
    await page.locator("body").focus()
    const position = await page.evaluate(() => [scrollX, scrollY])
    for (const key of [
      "End",
      "PageDown",
      "Space",
      "ArrowDown",
      "ArrowRight",
      "PageUp",
      "Shift+Space",
      "ArrowUp",
      "ArrowLeft",
      "Home",
      "Control+End",
      "Control+Home",
    ]) {
      await page.keyboard.press(key)
      const after = await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve([scrollX, scrollY]))),
      )
      assert.deepEqual(after, position, `${key} must not scroll while drawing`)
    }
    assert.deepEqual(await page.evaluate(() => window.pageKeys), ["Shift", "Control", "Control"])
    await page.keyboard.press("Escape")
    await page.keyboard.press("End")
    await page.waitForFunction((y) => scrollY > y, position[1])
    assert.equal(await page.evaluate(() => window.pageKeys.at(-1)), "End", "page keys resume after canceling")
  } finally {
    await browser.close()
  }
})

test("Esc and Undo take strokes back", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await ui.getByRole("button", { name: "Highlight" }).click()
    await drag(page, [100, 100], [300, 100])
    await page.keyboard.press("a")
    await drag(page, [100, 300], [300, 200])
    // An arrow too short to point anywhere isn't kept.
    await drag(page, [400, 400], [404, 402])
    assert.equal(await ui.locator(".ink path").count(), 2)
    await page.keyboard.press("Control+z")
    assert.equal(await ui.locator(".ink path").count(), 1)
    await page.keyboard.press("Escape")
    assert.equal(await ui.locator(".ink path").count(), 0)
    assert.equal(await ui.getByRole("button", { name: "Done" }).isVisible(), false)
    assert.equal(await ui.getByRole("button", { name: "Highlight" }).isVisible(), true)
    // Only the modifier itself reaches the page.
    assert.deepEqual(await page.evaluate(() => window.pageKeys), ["Control"])
  } finally {
    await browser.close()
  }
})

test("Highlight's Text tip types a label, edits, moves, and deletes it, and sends it on the screenshot", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px"
      scrollTo(0, 600)
      const popover = document.createElement("div")
      popover.id = "label-popover"
      popover.setAttribute("popover", "manual")
      popover.textContent = "Price details"
      document.body.append(popover)
      popover.showPopover()
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") popover.hidePopover()
        },
        true,
      )
    })
    await ui.getByRole("button", { name: "Highlight" }).click()
    const done = ui.getByRole("button", { name: "Done" })
    const label = ui.getByRole("textbox", { name: "Label" })
    const labels = ui.locator(".ink g")
    await page.keyboard.press("t")
    assert.equal(await ui.getByRole("button", { name: "Text" }).getAttribute("aria-pressed"), "true")

    // A click opens a label with the caret in it. Its letters are the label's, not the tips' or the page's.
    await page.mouse.click(300, 300)
    await label.waitFor()
    await page.keyboard.type("bpa [ too big")
    assert.equal(await ui.getByRole("button", { name: "Text" }).getAttribute("aria-pressed"), "true")
    assert.deepEqual(await page.evaluate(() => window.pageKeys), [])
    // Esc puts the label down and keeps Highlight open.
    const beforeScroll = await page.evaluate(() => scrollY)
    assert.ok(beforeScroll > 0, "both paging directions have room to scroll")
    for (const key of ["PageDown", "PageUp"]) {
      await page.keyboard.press(key)
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate(() => scrollY), beforeScroll, key + " keeps the viewport locked")
    }
    // Native caret navigation still works while page capture handlers are isolated.
    const typed = await label.inputValue()
    await page.keyboard.press("Home")
    await page.keyboard.press("Shift+End")
    assert.equal(await label.evaluate((input) => input.selectionEnd - input.selectionStart), typed.length)
    await page.keyboard.press("Escape")
    assert.equal(await page.locator("#label-popover").evaluate((el) => el.matches(":popover-open")), true)

    assert.equal(await label.count(), 0)
    assert.equal(await labels.count(), 1)
    assert.equal(await labels.locator("text").textContent(), "bpa [ too big")
    assert.equal(await done.isDisabled(), false)
    assert.equal(await ui.locator(".tools").isVisible(), true)

    // An empty label leaves nothing, and a click elsewhere only puts the open one down.
    await page.mouse.click(300, 450)
    await label.waitFor()
    await page.mouse.click(600, 450)
    assert.equal(await label.count(), 0)
    assert.equal(await labels.count(), 1)

    // A click on the label edits it; Enter puts it down.
    const at = await labels.boundingBox()
    await page.mouse.click(at.x + 10, at.y + at.height / 2)
    await label.waitFor()
    assert.equal(await label.inputValue(), "bpa [ too big")
    await label.fill("Too big")
    // A size or colour picked while it's open restyles it, and the caret stays in it.
    const small = await label.boundingBox()
    await ui.locator("[data-size='3']").click()
    await ui.getByRole("button", { name: "Blue ink" }).click()
    assert.equal(await label.count(), 1, "the pick keeps the label open")
    assert.ok((await label.boundingBox()).height > small.height * 1.5, "the label grew")
    await page.keyboard.type("!")
    await page.keyboard.press("Enter")
    assert.equal(await labels.locator("text").textContent(), "Too big!")
    assert.match(await labels.locator("text").getAttribute("style"), /\b36px\b/)
    assert.equal(await labels.locator("rect").getAttribute("fill"), "#2563eb")
    // Reopening keeps the label's own style even when the tool defaults differ.
    await ui.locator("[data-size='1']").click()
    await ui.getByRole("button", { name: "Pink ink" }).click()
    await page.mouse.click(at.x + 10, at.y + at.height / 2)
    await label.waitFor()
    assert.equal(await label.evaluate((el) => el.style.fontSize), "36px")
    assert.equal(await label.evaluate((el) => el.style.backgroundColor), "rgb(37, 99, 235)")
    await ui.getByRole("button", { name: "Green ink" }).click()
    assert.equal(await label.evaluate((el) => el.style.fontSize), "36px", "colour preserves the label's size")
    await page.keyboard.press("Enter")
    await ui.getByRole("button", { name: "Pink ink" }).click()
    await page.mouse.click(at.x + 10, at.y + at.height / 2)
    await label.waitFor()
    // Select the size already active in the toolbar, which still differs from the label.
    await ui.locator("[data-size='1']").click()
    assert.equal(await label.evaluate((el) => el.style.backgroundColor), "rgb(22, 163, 74)", "size preserves colour")
    await page.keyboard.press("Enter")
    assert.match(await labels.locator("text").getAttribute("style"), /\b20px\b/)
    assert.equal(await labels.locator("rect").getAttribute("fill"), "#16a34a")
    // Back to the default tip for the labels below: 20px, pink.
    await ui.locator("[data-size='1']").click()
    await ui.getByRole("button", { name: "Pink ink" }).click()

    // A drag moves it.
    const before = await labels.boundingBox()
    await drag(page, [before.x + 10, before.y + before.height / 2], [before.x + 110, before.y + before.height / 2 + 50])
    const after = await labels.boundingBox()
    assert.ok(Math.abs(after.x - before.x - 100) < 2 && Math.abs(after.y - before.y - 50) < 2, "moved by the drag")
    assert.equal(await label.count(), 0, "a drag doesn't open the label")

    // Clearing a label deletes it; Undo takes back the newest one.
    await page.mouse.click(100, 100)
    await page.keyboard.type("Second")
    await page.keyboard.press("Enter")
    assert.equal(await labels.count(), 2)
    await page.keyboard.press("Meta+z")
    assert.equal(await labels.count(), 1)
    const kept = await labels.boundingBox()
    await page.mouse.click(kept.x + 10, kept.y + kept.height / 2)
    await label.fill("")
    await page.keyboard.press("Enter")
    assert.equal(await labels.count(), 0)
    assert.equal(await done.isDisabled(), true)

    // ⌘Enter while typing puts the label down and sends; the pill is on the screenshot, in pink.
    await page.mouse.click(200, 200)
    await page.keyboard.type("Too big")
    await page.keyboard.press("Meta+Enter")
    const note = ui.getByRole("textbox", { name: "Comment" })
    await note.waitFor()
    assert.equal(await labels.count(), 1, "the label stays while the note is written")
    const pill = await labels.locator("rect").boundingBox()
    await note.fill("Smaller, please")
    await ui.getByRole("button", { name: "Send" }).click()
    await page.waitForFunction(() => window.sent.length === 1)
    const color = await page.evaluate(
      async ([x, y]) => {
        const image = await createImageBitmap(window.sent[0].get("screenshot"))
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext("2d")
        g.drawImage(image, 0, 0)
        const k = image.width / innerWidth
        return Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data)
      },
      [pill.x + 3, pill.y + pill.height / 2],
    )
    // #ec4899
    assert.ok(
      Math.abs(color[0] - 0xec) < 12 && Math.abs(color[1] - 0x48) < 12 && Math.abs(color[2] - 0x99) < 12,
      `pink pill, got ${color}`,
    )
  } finally {
    await browser.close()
  }
}, 30_000)
