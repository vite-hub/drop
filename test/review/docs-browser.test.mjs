import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"
const CORS = { "access-control-allow-origin": SITE, "access-control-allow-headers": "authorization, content-type" }
const DOCS = [
  {
    open: "handle-1",
    title: "Before/after: pricing",
    links: [
      { url: "https://github.com/acme/app/pull/12", label: "PR #12", host: "github.com", icons: [] },
      {
        url: "https://linear.app/acme/issue/ACM-7",
        label: "linear.app",
        host: "",
        icons: ["https://linear.app/favicon.ico"],
      },
    ],
  },
  { open: "handle-2", title: "Pricing plan", links: [] },
]

/**
 * The site with review.js, and a Drop that answers whether a doc links to it (`linked`) and, with a token, which ones
 * (`docs`). Its connect popup hands the page a token, as Drop's does. The toolbar's closed shadow root is opened here
 * so the test can reach it.
 */
async function open(browser, { linked = true, docs = DOCS, connected = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  await context.addInitScript(
    ({ drop, connected }) => {
      const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
      Element.prototype.attachShadow = function (init) {
        return Reflect.apply(attach, this, [{ ...init, mode: "open" }])
      }
      if (connected && location.origin !== drop)
        sessionStorage.setItem(
          "drop-review:" + drop,
          JSON.stringify({ token: "t", expiresAt: Date.now() + 3600_000, name: "Ada" }),
        )
    },
    { drop: DROP, connected },
  )
  const asked = []
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Pro</h1><script src="${DROP}/review.js"></script>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (url.pathname === "/review/connect")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>opener.postMessage({ __dropReview: true, token: "t", expiresAt: Date.now() + 3600000, name: "Ada" }, ${JSON.stringify(SITE)}); setTimeout(() => close(), 50)</script>`,
      })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    const token = request.headers().authorization
    if (url.pathname === "/api/review/docs") {
      asked.push(token ?? "none")
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(token ? { linked: docs.length > 0, docs } : { linked }),
      })
    }
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ threads: [] }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/")
  const pill = page.locator("drop-review drop-review-pill")
  await pill.locator("button.mark").waitFor()
  return {
    context,
    page,
    pill,
    asked,
    button: pill.locator("[data-act=docs]"),
    menu: page.locator("drop-review .docs"),
  }
}

test("Drop document shows on a site a doc links to, connects on the first press, and lists each doc with its links", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, pill, asked, button, menu } = await open(browser)
    // Before connecting, the page only knows a doc links here.
    await button.waitFor()
    assert.deepEqual(asked, ["none"])
    assert.equal(await button.textContent(), "Drop document")
    assert.equal(await button.getAttribute("aria-expanded"), "false")

    // The first press connects through Drop's popup, then opens the menu with the docs this reviewer may see.
    await button.click()
    await menu.waitFor()
    assert.deepEqual(asked.slice(-1), ["Bearer t"])
    assert.equal(await button.getAttribute("aria-expanded"), "true")
    assert.equal(await menu.locator(".label").textContent(), "Drop documents")
    const links = await menu
      .locator("a")
      .evaluateAll((anchors) =>
        anchors.map((a) => [a.querySelector(".name").textContent, a.getAttribute("href"), a.target]),
      )
    assert.deepEqual(links, [
      ["Before/after: pricing", `${DROP}/review/open#doc=handle-1`, "_blank"],
      ["PR #12", "https://github.com/acme/app/pull/12", "_blank"],
      ["linear.app", "https://linear.app/acme/issue/ACM-7", "_blank"],
      ["Pricing plan", `${DROP}/review/open#doc=handle-2`, "_blank"],
    ])
    // A link opens the doc in Drop, never a link to it: the doc's row says Drop, its links their hosts.
    assert.deepEqual(await menu.locator(".host").allTextContents(), ["Drop", "github.com", "Drop"])
    assert.equal(
      await menu
        .locator("a")
        .first()
        .evaluate((a) => a === a.getRootNode().activeElement),
      true,
    )
    // A favicon the site can't load falls back to a plain link icon; GitHub gets its mark.
    await menu.locator("a").nth(2).locator("svg").first().waitFor()
    assert.equal(await menu.locator("a").nth(1).locator("svg.gh").count(), 1)

    // It opens beside the pill, on its edge: above a pill at the bottom.
    const [menuBox, pillBox] = [await menu.boundingBox(), await pill.locator("[slot=review]").boundingBox()]
    assert.ok(menuBox.y + menuBox.height < pillBox.y, "the menu sits above a pill at the bottom")

    // Esc closes it, and so does a press on the page.
    await page.keyboard.press("Escape")
    await menu.waitFor({ state: "hidden" })
    await button.click()
    await menu.waitFor()
    await page.mouse.click(450, 100)
    await menu.waitFor({ state: "hidden" })
    // Comment closes it too.
    await button.click()
    await menu.waitFor()
    await pill.getByRole("button", { name: "Comment", exact: true }).click()
    await menu.waitFor({ state: "hidden" })
    await context.close()
  } finally {
    await browser.close()
  }
})

test("Drop document stays hidden where no doc links to the site, or none is shared with the reviewer", async () => {
  const browser = await chromium.launch()
  try {
    const none = await open(browser, { linked: false })
    await none.page.waitForFunction(() => true)
    await none.page.waitForTimeout(300)
    assert.deepEqual(none.asked, ["none"])
    assert.equal(await none.button.isVisible(), false)
    await none.context.close()

    // Connected, the list decides: a doc this reviewer can't see leaves the option hidden.
    const hidden = await open(browser, { connected: true, docs: [] })
    await hidden.page.waitForTimeout(300)
    assert.deepEqual(hidden.asked, ["Bearer t"])
    assert.equal(await hidden.button.isVisible(), false)
    await hidden.context.close()

    // Linked but not shared: connecting says so and hides the option.
    const unshared = await open(browser, { docs: [] })
    await unshared.button.click()
    await unshared.page
      .locator("drop-review .toast")
      .getByText("No Drop document that links here is shared with you.")
      .waitFor()
    assert.equal(await unshared.button.isVisible(), false)
    await unshared.context.close()
  } finally {
    await browser.close()
  }
})
