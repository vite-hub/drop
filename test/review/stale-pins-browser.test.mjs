import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"

// A settings page after an agent's fixes: Reset defaults became Save changes, the note under the form
// is gone, and the heading moved down a section.
const PAGE = `<main style="font:14px sans-serif;padding:40px">
  <section><h2>Totals</h2></section>
  <section><h2>Notifications</h2></section>
  <div id="bar" style="display:flex;gap:8px;margin:60px 0 0 400px">
    <button style="width:120px;height:32px">Save changes</button><button style="width:120px;height:32px">Cancel</button>
  </div>
  <table style="margin-top:16px"><tr><td>Weekly digest</td><td>On</td><td>Email</td></tr></table>
</main>`

const thread = (n, selector, label, extra = {}) => ({
  n,
  body: "Note " + n,
  resolved: false,
  replies: [],
  images: [],
  author: { name: "Ada Lovelace", image: "https://avatars.example/identicon.png" },
  element: { selector, label },
  spot: { x: 500, y: 500 },
  createdAt: 0,
  ...extra,
})

const THREADS = [
  // Two comments on the button as it is now.
  thread(1, "body > main > div > button:nth-of-type(1)", 'button "Save changes"'),
  thread(2, "body > main > div > button:nth-of-type(1)", 'button "Save changes"', { author: { name: "Sam" } }),
  // Left on the button before it changed: the same path now names another button.
  thread(3, "body > main > div > button:nth-of-type(1)", 'button "Reset defaults"'),
  // Left on a note the page no longer has.
  thread(4, "body > main > p", 'p "Last saved 13.09"'),
  // Left on the heading where it used to be: its path finds nothing, its words find it.
  thread(5, "body > main > h2", 'h2 "Notifications"'),
]

async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
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
  const cors = { "access-control-allow-origin": SITE, "access-control-allow-headers": "authorization, content-type" }
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><body style="margin:0">${PAGE}<script src="${DROP}/review.js" defer></script></body></html>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ threads: THREADS }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/accountsettings")
  const ui = page.locator("drop-review")
  await ui.locator(".pin:not([hidden])").first().waitFor()
  return { page, ui }
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test("pins of comments whose element changed or is gone don't land elsewhere on the page", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    const pins = ui.locator(".pin:not([hidden])")
    // The two on Save changes are one pin, the moved heading has its own, and nothing else shows.
    assert.deepEqual((await pins.allTextContents()).sort(), ["2", "AL"])
    const heading = await page.getByRole("heading", { name: "Notifications" }).boundingBox()
    const headingPin = await ui.locator(".pin:not([hidden])", { hasText: "AL" }).boundingBox()
    assert.ok(Math.abs(headingPin.y + headingPin.height - (heading.y + heading.height / 2)) < 2, "found by its words")

    // The toolbar counts the three that are still on the page; the list keeps the outdated two behind a toggle.
    assert.equal(await ui.locator("[data-act=list] .count").textContent(), "3")
    await ui.locator("[data-act=list]").click()
    const rows = ui.locator(".list .row-item")
    assert.equal(await rows.count(), 3)
    const toggle = ui.getByText("2 outdated")
    await toggle.click()
    assert.equal(await rows.count(), 5)
    await ui
      .locator(".list .row-item", { hasText: "Note 3" })
      .getByText('Outdated: button "Reset defaults" isn\'t on the page now')
      .waitFor()
  } finally {
    await browser.close()
  }
}, 20_000)

test("a pin on a button sits beside it, pins on one spot become one, and pointing at a pin outlines its element", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    const button = await page.getByRole("button", { name: "Save changes" }).boundingBox()
    const next = await page.getByRole("button", { name: "Cancel" }).boundingBox()
    const pin = ui.locator(".pin:not([hidden])", { hasText: "2" })
    const box = await pin.boundingBox()
    assert.equal(overlaps(box, button), false, "the pin doesn't cover the button it's about")
    assert.equal(overlaps(box, next), false, "or the one beside it")
    assert.equal(await pin.getAttribute("aria-label"), "2 comments here")

    await pin.hover()
    const mark = await ui.locator("div.mark").boundingBox()
    assert.ok(
      Math.abs(mark.x + 3 - button.x) < 1 && Math.abs(mark.width - 6 - button.width) < 1,
      "outlines Save changes",
    )

    // A press on it lists its two comments.
    await pin.click()
    assert.equal(await ui.locator(".list .title").textContent(), "2 comments here")
    assert.deepEqual(await ui.locator(".list .row-item .text").allTextContents(), ["Note 1", "Note 2"])
  } finally {
    await browser.close()
  }
}, 20_000)
