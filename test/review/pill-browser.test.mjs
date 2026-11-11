import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "playwright"
import { expect, test } from "vite-plus/test"
import { compileScript, parse } from "vue/compiler-sfc"
import { transpileModule, ModuleKind } from "typescript"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

// Mount the real copy page in Drop's popup, with only Nuxt's shell and API replaced.
const require = createRequire(import.meta.url)
const vue = readFileSync(require.resolve("vue/dist/vue.esm-browser.prod.js"), "utf8")
const source = readFileSync(new URL("../../app/pages/review/open.vue", import.meta.url), "utf8")
const { descriptor } = parse(source)
const copyPage = transpileModule(compileScript(descriptor, { id: "review-open", inlineTemplate: true }).content, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText

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
      if (!sessionStorage.getItem("drop-review:" + drop))
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

test("the toolbar's Copy link opens Drop's copy page with the token, so the site never sees the review's link", async () => {
  const browser = await chromium.launch()
  try {
    const { context, pill } = await open(browser)
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      pill.getByRole("button", { name: "Copy the review's link" }).click(),
    ])
    assert.equal(popup.url(), DROP + "/review/open?copy#t")
    await context.close()
  } finally {
    await browser.close()
  }
})

async function serveOpenPage(context) {
  await context.route(DROP + "/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/vue.js" || path === "/copy-page.js")
      return route.fulfill({ contentType: "text/javascript", body: path === "/vue.js" ? vue : copyPage })
    if (path === "/api/review/open") {
      const { token, doc } = route.request().postDataJSON()
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          doc ? { to: "/drops/document" } : { to: "/drops/" + token, link: DROP + "/d/" + token + "/review" },
        ),
      })
    }
    if (path !== "/review/open") return route.fallback()
    return route.fulfill({
      contentType: "text/html",
      body: `<div id="app"></div><script type="importmap">{"imports":{"vue":"/vue.js"}}</script>
        <script type="module">
          import * as Vue from "vue"
          import CopyPage from "/copy-page.js"
          Object.assign(window, Vue)
          window.useSeoMeta = () => {}
          window.useRoute = () => ({ query: Object.fromEntries(new URLSearchParams(location.search)), get hash() { return decodeURIComponent(location.hash) } })
          window.useMe = async () => ({ data: Vue.ref({ name: "Ada" }) })
          window.useMounted = () => { const ready = Vue.ref(false); Vue.onMounted(() => ready.value = true); return ready }
          window.openReview = body => fetch("/api/review/open", { method: "POST", body: JSON.stringify(body) }).then(r => r.json())
          window.navigateTo = to => location.replace(to)
          window.errorText = error => error.message
          const app = Vue.createApp({ render: () => Vue.h(Vue.Suspense, null, { default: () => Vue.h(CopyPage) }) })
          app.component("UButton", {
            props: ["label"],
            setup: (props, { attrs }) => () => Vue.h("button", attrs, props.label),
          })
          app.mount("#app")
        </script>`,
    })
  })
}

test("Open in Drop opens reviews by token and related documents by handle", async () => {
  const browser = await chromium.launch()
  try {
    const { context } = await open(browser)
    await serveOpenPage(context)
    for (const [hash, body, target] of [
      ["#t", { token: "t" }, "/drops/t"],
      ["#doc=" + encodeURIComponent("sealed/handle+="), { doc: "sealed/handle+=" }, "/drops/document"],
    ]) {
      const popup = await context.newPage()
      const request = popup.waitForRequest(DROP + "/api/review/open")
      await popup.goto(DROP + "/review/open" + hash)
      assert.deepEqual((await request).postDataJSON(), body)
      await popup.waitForURL(DROP + target)
      await popup.close()
    }
    await context.close()
  } finally {
    await browser.close()
  }
})

test("Copy link copies the requested review while an earlier fallback window stays open", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, pill } = await open(browser)
    await context.grantPermissions([], { origin: DROP })
    await serveOpenPage(context)
    const [first] = await Promise.all([
      context.waitForEvent("page"),
      pill.getByRole("button", { name: "Copy the review's link" }).click(),
    ])
    await first.getByRole("button", { name: "Copy link", exact: true }).waitFor()
    assert.equal(await first.locator("p").textContent(), DROP + "/d/t/review")

    // Reconnect the same site to another review, leaving the first manual-copy fallback open.
    await page.evaluate((drop) => {
      sessionStorage.setItem(
        "drop-review:" + drop,
        JSON.stringify({ token: "second", expiresAt: Date.now() + 3600_000, name: "Ada" }),
      )
    }, DROP)
    await page.reload()
    await pill.getByRole("button", { name: "Copy the review's link" }).click()
    const secondUrl = DROP + "/review/open?copy#second"
    await expect.poll(() => context.pages().some((popup) => popup.url() === secondUrl)).toBe(true)
    const second = context.pages().find((popup) => popup.url() === secondUrl)
    await second.getByRole("button", { name: "Copy link", exact: true }).waitFor()
    assert.equal(await second.locator("p").textContent(), DROP + "/d/second/review")

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: DROP })
    await second.getByRole("button", { name: "Copy link", exact: true }).click()
    await second.getByRole("status").filter({ hasText: "Link copied" }).waitFor()
    assert.equal(await second.evaluate(() => navigator.clipboard.readText()), DROP + "/d/second/review")
    await second.waitForEvent("close")
    assert.equal(first.isClosed(), false)
    assert.equal(await first.locator("p").textContent(), DROP + "/d/t/review")
    await context.close()
  } finally {
    await browser.close()
  }
})
