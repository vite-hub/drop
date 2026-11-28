// Chromium e2e for the spike: Playwright's bundled Chromium, persistent context, headless=new.
// Needs harness/server.mjs running. Usage: SPIKE_DPR=1 node harness/chromium.mjs
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { pngSize, step, report } from "./util.mjs"

const dpr = Number(process.env.SPIKE_DPR ?? 1)
const headless = process.env.SPIKE_HEADED !== "1"
const extension = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const results = fileURLToPath(new URL("../results/", import.meta.url))
const origin = "http://127.0.0.1:47810"
const out = { browser: "chromium", dpr, headless }

const profile = mkdtempSync(join(tmpdir(), "drop-spike-chromium-"))
const context = await chromium.launchPersistentContext(profile, {
  // `channel: "chromium"` is the full build in new headless mode; the default headless shell can't load extensions.
  channel: "chromium",
  headless,
  viewport: null,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--enable-unsafe-extension-debugging",
    `--force-device-scale-factor=${dpr}`,
    "--window-size=800,600",
    ...(process.env.SPIKE_AUTOCONFIRM ? [`--apps-gallery-install-auto-confirm-for-tests=accept`] : []),
  ],
})
out.version = context.browser()?.version()
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
const id = new URL(worker.url()).host
out.extensionId = id
const events = () => worker.evaluate(async () => (await chrome.storage.local.get("events")).events ?? [])
const clearEvents = () => worker.evaluate(() => chrome.storage.local.set({ events: [] }))
// Headed runs under Xvfb press real keys for browser UI that Playwright can't reach.
const xkeys = (...keys) => execFileSync("python3", [fileURLToPath(new URL("./xkey.py", import.meta.url)), ...keys])
const dialogKeys = (process.env.SPIKE_DIALOG_KEYS ?? "Tab Return").split(" ")
const send = (page, message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message)

async function triggerAction(url) {
  const session = await context.browser().newBrowserCDPSession()
  const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab" }] })
  const target = targetInfos.find((t) => t.url === url)
  await session.send("Extensions.triggerAction", { id, targetId: target.targetId })
}

async function waitForEvent(kind, page, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const hit = (await events()).find((e) => e.kind === kind)
    if (hit) return hit.detail
    await page.waitForTimeout(250)
  }
  throw new Error(`${kind} never logged`)
}

const options = await context.newPage()
await options.goto(`chrome-extension://${id}/options.html`)
const tab = await context.newPage()
await tab.goto(`${origin}/page`)
// Without the "tabs" permission tab.url is hidden, so take the newest tab that isn't one of our pages.
const tabId = await worker.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)))
out.tabId = tabId
out.startupEvents = await events()

// Row 7: options page with the network off.
out.row7 = await step("offline icon", async () => {
  const requests = []
  const page = await context.newPage()
  page.on("request", (request) => requests.push(request.url()))
  await context.setOffline(true)
  try {
    await page.goto(`chrome-extension://${id}/options.html`)
    await page.waitForSelector("svg#icon path", { timeout: 5000 })
    const icon = await page.$eval("#icon", (el) => ({ tag: el.tagName, paths: el.querySelectorAll("path").length, size: el.getBoundingClientRect().width }))
    const buttonIconPaths = await page.$eval("#grant", (el) => el.querySelectorAll("svg path").length)
    await page.screenshot({ path: join(results, `chromium-options-offline-dpr${dpr}.png`) })
    return { icon, buttonIconPaths, requests }
  } finally {
    await context.setOffline(false)
    await page.close()
  }
})

// Row 1: permissions.request on a user gesture from the options page.
out.row1 = await step("permissions.request", async () => {
  await options.bringToFront()
  await options.click("#grant")
  if (!headless) {
    await options.waitForTimeout(1500)
    xkeys(...dialogKeys)
  }
  await options.waitForFunction(() => document.querySelector("#result")?.textContent, null, { timeout: 15_000 })
  return JSON.parse(await options.textContent("#result"))
}, 20_000)

// Row 2: injection into the active tab.
out.row2 = {}
await tab.bringToFront()
await clearEvents()
out.row2.noGesture = await step("inject without gesture", () => send(options, { type: "inject", tabId, via: "no-gesture" }))

out.row2.keyboardCommand = await step("Alt+Shift+Y via Playwright keyboard", async () => {
  await clearEvents()
  await tab.bringToFront()
  await tab.keyboard.press("Alt+Shift+Y")
  await tab.waitForTimeout(1500)
  return (await events()).filter((e) => e.kind === "command" || e.kind === "inject")
})

if (!headless) {
  out.row2.xtestCommand = await step("Alt+Shift+Y as a real X key press", async () => {
    await clearEvents()
    await tab.bringToFront()
    xkeys("alt+shift+y")
    await tab.waitForTimeout(2000)
    return (await events()).filter((e) => e.kind === "command" || e.kind === "inject")
  })
}

out.row2.triggerAction = await step("CDP Extensions.triggerAction opens the popup", async () => {
  await clearEvents()
  await triggerAction(`${origin}/page`)
  return waitForEvent("popup-run", tab)
}, 20_000)

if (out.row2.triggerAction.ok) {
  const shot = out.row2.triggerAction.value.capture
  const viewport = await tab.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }))
  out.row3 = { viewport, image: typeof shot === "string" ? pngSize(shot) : shot }
  if (typeof shot === "string") {
    writeFileSync(join(results, `chromium-capture-dpr${dpr}.png`), Buffer.from(shot.split(",")[1], "base64"))
    out.row3.matches =
      out.row3.image.width === Math.round(viewport.w * viewport.dpr) &&
      out.row3.image.height === Math.round(viewport.h * viewport.dpr)
  }
  out.row2.triggerAction.value.capture = "see row3"
}

out.row2.beforeNav = await step("re-inject on the same page, no navigation", () =>
  send(options, { type: "inject", tabId, via: "before-nav" }),
)
out.row2.sameOriginNav = await step("re-inject after same-origin navigation", async () => {
  await tab.click("#next")
  await tab.waitForURL(`${origin}/page2`)
  return send(options, { type: "inject", tabId, via: "after-same-origin-nav" })
})
out.row2.crossOriginNav = await step("re-inject after cross-origin navigation", async () => {
  await tab.goto("http://localhost:47810/page")
  return send(options, { type: "inject", tabId, via: "after-cross-origin-nav" })
})

// Row 4: closed shadow root on a strict-CSP page (fresh activeTab grant on the new page).
out.row4 = await step("shadow root on CSP page", async () => {
  await tab.goto(`${origin}/csp`)
  await clearEvents()
  await triggerAction(`${origin}/csp`)
  await tab.waitForFunction(() => document.documentElement.dataset.dropSpike, null, { timeout: 10_000 })
  return JSON.parse(await tab.evaluate(() => document.documentElement.dataset.dropSpike))
}, 20_000)

// Row 2b: a host permission for the origin makes injection automatic through tabs.onUpdated.
out.row2.onUpdatedWithHost = await step("tabs.onUpdated with host permission", async () => {
  await options.goto(`chrome-extension://${id}/options.html?origin=${encodeURIComponent(`${origin}/*`)}`)
  await options.click("#grant")
  if (!headless) {
    await options.waitForTimeout(1500)
    xkeys(...dialogKeys)
  }
  await options.waitForFunction(() => document.querySelector("#result")?.textContent, null, { timeout: 15_000 })
  const grant = JSON.parse(await options.textContent("#result"))
  await clearEvents()
  await tab.goto(`${origin}/page`)
  await tab.waitForTimeout(1500)
  return { grant, events: (await events()).filter((e) => e.kind === "inject" || e.kind === "onUpdated") }
}, 25_000)

// Row 5: does launchWebAuthFlow see the cookie a normal tab set?
out.row5 = await step("launchWebAuthFlow", async () => {
  await tab.goto(`${origin}/session`)
  const sid = await tab.textContent("#sid")
  const { url: redirect } = await send(options, { type: "redirect-url" })
  const result = await send(options, {
    type: "auth",
    url: `${origin}/auth?redirect_uri=${encodeURIComponent(redirect)}`,
    interactive: true,
  })
  return { sid, redirect, result, sawCookie: result.url ? new URL(result.url).searchParams.get("code") === sid : false }
}, 30_000)

report(out, join(results, `chromium-dpr${dpr}${headless ? "" : "-headed"}.json`))
await context.close()
rmSync(profile, { recursive: true, force: true })
