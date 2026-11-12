import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"
const CORS = { "access-control-allow-origin": SITE, "access-control-allow-headers": "authorization, content-type" }
const GROUPS = [
  {
    open: "handle-1",
    title: "Before/after: pricing",
    links: [
      { url: "https://github.com/acme/app/pull/12", label: "PR #12", detail: "github.com", icons: [] },
      {
        url: "https://linear.app/acme/issue/ACM-7",
        label: "linear.app",
        detail: "",
        icons: ["https://linear.app/favicon.ico"],
      },
    ],
  },
  { open: "handle-2", title: "Pricing plan", links: [] },
]

/**
 * The site with review.js, and a Drop that answers whether a drop links to it (`linked`) and, with a token, the
 * related drops (`groups`). Its connect popup hands the page a token, as Drop's does. The toolbar's closed shadow root is opened here
 * so the test can reach it.
 */
async function open(browser, { linked = true, groups = GROUPS, connected = false, relatedGate } = {}) {
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
  const posts = []
  await context.route("**/*", async (route) => {
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
    if (url.pathname === "/api/review/related") {
      asked.push(token ?? "none")
      if (token) await relatedGate
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(token ? { linked: groups.length > 0, groups } : { linked }),
      })
    }
    if (url.pathname === "/api/review/comments" && request.method() === "POST") {
      posts.push(request.postData())
      return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ n: 1 }) })
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
    posts,
    button: pill.locator(".related button"),
    menu: page.locator("drop-review .links"),
  }
}

test("Related links shows on a site a drop links to, connects on the first press, and lists each drop and its links in one list", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, pill, asked, button, menu } = await open(browser)
    // Before connecting, the page only knows a drop links here.
    await button.waitFor()
    assert.deepEqual(asked, ["none"])
    assert.equal(await button.textContent(), "Related links")
    assert.equal(await button.getAttribute("aria-expanded"), "false")

    // The first press connects through Drop's popup, then opens the menu with the drops this reviewer may see.
    await button.click()
    await menu.waitFor()
    assert.deepEqual(asked.slice(-1), ["Bearer t"])
    assert.equal(await button.getAttribute("aria-expanded"), "true")
    assert.equal(await menu.locator("p").first().textContent(), "Related links")
    // One list, every row alike: each drop, then its links.
    assert.equal(await menu.locator("ul").count(), 1)
    const rows = await menu
      .locator("a")
      .evaluateAll((anchors) =>
        anchors.map((a) => [
          a.querySelector(".name").textContent,
          a.getAttribute("href"),
          a.querySelector(".detail")?.textContent ?? "",
          a.target,
        ]),
      )
    assert.deepEqual(rows, [
      ["Before/after: pricing", `${DROP}/review/open#doc=handle-1`, "Drop", "_blank"],
      ["PR #12", "https://github.com/acme/app/pull/12", "github.com", "_blank"],
      ["linear.app", "https://linear.app/acme/issue/ACM-7", "", "_blank"],
      ["Pricing plan", `${DROP}/review/open#doc=handle-2`, "Drop", "_blank"],
    ])
    assert.equal(
      await menu
        .locator("a")
        .first()
        .evaluate((a) => a === a.getRootNode().activeElement),
      true,
    )
    // A favicon the site can't load, or none, falls back to a link icon, on the same light plate a favicon gets so a
    // black mark still shows on the dark menu.
    await menu.locator("a").nth(2).locator(".site svg").waitFor()
    assert.equal(await menu.locator("a").nth(1).locator(".site svg").count(), 1)
    assert.equal(
      await menu
        .locator("a")
        .nth(2)
        .locator(".site")
        .evaluate((plate) => getComputedStyle(plate).backgroundColor),
      "rgb(255, 255, 255)",
    )

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
    // Comment closes it too, and the button goes with the review buttons while someone draws.
    await button.click()
    await menu.waitFor()
    await pill.getByRole("button", { name: "Comment", exact: true }).click()
    await menu.waitFor({ state: "hidden" })
    await page.keyboard.press("Escape")
    await pill.getByRole("button", { name: "Highlight", exact: true }).click()
    await button.waitFor({ state: "hidden" })
    await page.keyboard.press("Escape")
    await button.waitFor()
    // The links stay until the session ends: a second open asks Drop nothing.
    const before = asked.length
    await button.click()
    await menu.waitFor()
    assert.equal(asked.length, before)
    // A press elsewhere on the toolbar closes it too, like the mark that folds the pill.
    await pill.locator("button.mark").click()
    await menu.waitFor({ state: "hidden" })
    await context.close()
  } finally {
    await browser.close()
  }
})

test("Related links stays hidden where no drop links to the site, and says so when none is shared with the reviewer", async () => {
  const browser = await chromium.launch()
  try {
    const none = await open(browser, { linked: false })
    await none.page.waitForTimeout(300)
    assert.deepEqual(none.asked, ["none"])
    assert.equal(await none.button.isVisible(), false)
    await none.context.close()

    // Connected or not, the page asks only whether a drop links here before anyone presses the button.
    const connected = await open(browser, { linked: false, connected: true })
    await connected.page.waitForTimeout(300)
    assert.deepEqual(connected.asked, ["none"])
    assert.equal(await connected.button.isVisible(), false)
    await connected.context.close()

    // Linked but not shared: the menu says so.
    const unshared = await open(browser, { groups: [] })
    await unshared.button.click()
    await unshared.menu.getByText("No drop related to this site is shared with you.").waitFor()
    await unshared.context.close()
  } finally {
    await browser.close()
  }
})

test("a delayed Related links lookup preserves a newer comment and its selected anchor", async () => {
  const browser = await chromium.launch()
  let release
  const relatedGate = new Promise((resolve) => {
    release = resolve
  })
  try {
    const { context, page, pill, button, menu, posts } = await open(browser, { connected: true, relatedGate })
    await button.click()
    await pill.locator(".related button[aria-busy=true]").waitFor()
    await pill.getByRole("button", { name: "Comment", exact: true }).click()
    const heading = await page.locator("h1").boundingBox()
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2)
    const note = page.locator("drop-review .pop textarea")
    await note.fill("Keep this anchor")
    release()
    await pill.locator(".related button:not([aria-busy])").waitFor({ state: "attached" })
    assert.equal(await menu.isVisible(), false)
    assert.equal(await note.isVisible(), true)
    assert.equal(await note.inputValue(), "Keep this anchor")
    await page.locator("drop-review .pop").getByRole("button", { name: "Send", exact: true }).click()
    await page.locator("drop-review").getByText("Sent as #1.").waitFor()
    assert.match(posts[0], /Keep this anchor/)
    assert.match(posts[0], /"selector":"body > h1"/)
    await context.close()
  } finally {
    release()
    await browser.close()
  }
})

for (const dismissal of ["outside press", "Escape", "second press"]) {
  test(`a delayed Related links lookup stays dismissed after ${dismissal} and caches its result`, async () => {
    const browser = await chromium.launch()
    let release
    const relatedGate = new Promise((resolve) => {
      release = resolve
    })
    try {
      const { context, page, pill, button, menu, asked } = await open(browser, { connected: true, relatedGate })
      await button.click()
      await pill.locator(".related button[aria-busy=true]").waitFor()
      if (dismissal === "outside press") await page.mouse.click(450, 100)
      else if (dismissal === "Escape") await page.keyboard.press("Escape")
      else await button.click()
      release()
      await pill.locator(".related button:not([aria-busy])").waitFor()
      assert.equal(await menu.isVisible(), false)
      assert.equal(await button.getAttribute("aria-expanded"), "false")
      const before = asked.length
      await button.click()
      await menu.waitFor()
      assert.equal(asked.length, before, "dismissed results can still fill the cache")
      await context.close()
    } finally {
      release()
      await browser.close()
    }
  })
}

test("reopening a pending Related links lookup uses the same request and the latest open intent", async () => {
  const browser = await chromium.launch()
  let release
  const relatedGate = new Promise((resolve) => {
    release = resolve
  })
  try {
    const { context, page, pill, button, menu, asked } = await open(browser, { connected: true, relatedGate })
    await button.click()
    await pill.locator(".related button[aria-busy=true]").waitFor()
    await page.keyboard.press("Escape")
    await button.click()
    release()
    await menu.waitFor()
    assert.equal(await button.getAttribute("aria-expanded"), "true")
    assert.equal(asked.filter((token) => token === "Bearer t").length, 1)
    await context.close()
  } finally {
    release()
    await browser.close()
  }
})
