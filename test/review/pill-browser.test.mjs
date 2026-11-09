import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" }
const THREADS = [
  {
    n: 1,
    body: "Too tight",
    author: { name: "Ada" },
    resolved: false,
    createdAt: 0,
    element: { selector: "h1" },
    replies: [],
  },
]

async function open(browser, attributes = "") {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  // The toolbar's shadow root is closed; opened here so the test can reach it. A connected reviewer.
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
    },
    { drop: DROP },
  )
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Pro</h1><script src="${DROP}/review.js" ${attributes}></script>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ threads: THREADS }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/")
  const pill = page.locator("drop-review drop-review-pill")
  // The mark shows in either state; a collapsed pill hides its buttons.
  await pill.locator("button.mark").waitFor()
  return { context, page, pill, mark: pill.locator("button.mark") }
}

const place = (pill) =>
  pill.evaluate((el) => [el.getAttribute("edge"), el.style.getPropertyValue("--at"), el.hasAttribute("collapsed")])

test(
  "the toolbar is ViteHub's page pill: it starts where the tag says, drags to an edge, collapses, and remembers",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const { context, page, pill, mark } = await open(browser, 'data-edge="top" data-at="0" data-collapsed')
      assert.deepEqual(await place(pill), ["top", "0", true])
      assert.equal(await mark.getAttribute("aria-label"), "Show Drop review tools")
      await mark.click()
      assert.deepEqual(await place(pill), ["top", "0", false])
      // The mark slides back to the end of the bar as it opens.
      await page.waitForTimeout(400)

      const box = await mark.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      for (const [x, y] of [
        [450, 300],
        [890, 300],
      ])
        await page.mouse.move(x, y, { steps: 4 })
      await page.mouse.up()
      const [edge, at] = await place(pill)
      assert.equal(edge, "right")
      assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("drop-review-dock"))), {
        edge: "right",
        at: Number(at),
      })

      // The comment list opens beside the pill, on its edge.
      await pill.locator("[data-act=list]").click()
      const list = page.locator("drop-review .list")
      const [listBox, pillBox] = [await list.boundingBox(), await pill.locator("[slot=review]").boundingBox()]
      assert.ok(listBox.x + listBox.width < pillBox.x, "the list sits left of a pill on the right edge")

      // The browser's place wins over the tag on the next load.
      await page.reload()
      await pill.locator("button.mark").waitFor()
      assert.deepEqual(await place(pill), ["right", at, false])
      await context.close()
    } finally {
      await browser.close()
    }
  },
)

test("the pill steps aside while a spot is picked and comes back after", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, pill } = await open(browser)
    assert.deepEqual(await place(pill), ["bottom", "50", false])
    await pill.getByRole("button", { name: "Comment", exact: true }).click()
    await page.locator("drop-review .draw").waitFor()
    assert.equal(await pill.isVisible(), false)
    await page.keyboard.press("Escape")
    await pill.getByRole("button", { name: "Comment", exact: true }).waitFor()
    assert.equal(await pill.isVisible(), true)
    await context.close()
  } finally {
    await browser.close()
  }
})

test("Copy link opens Drop's copy page with the token, so the site never sees the review's link", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, pill } = await open(browser)
    await pill.locator("[data-act=list]").click()
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Copy the review's link" }).click(),
    ])
    assert.equal(popup.url(), DROP + "/review/open?copy#t")
    await context.close()
  } finally {
    await browser.close()
  }
})
