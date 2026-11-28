// Firefox e2e for the spike: selenium-webdriver + geckodriver (Marionette) on a Firefox 128 ESR binary.
// Marionette's chrome context reaches browser UI (toolbar button, permission doorhanger) that BiDi can't in 128.
// Needs harness/server.mjs running. Usage: SPIKE_DPR=1 node harness/firefox.mjs <firefox binary>
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Builder, By, Key, until } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"
import { Command } from "selenium-webdriver/lib/command.js"
import { pngSize, step, report } from "./util.mjs"

const binary = process.argv[2]
const dpr = Number(process.env.SPIKE_DPR ?? 1)
const headless = process.env.SPIKE_HEADED !== "1"
const source = fileURLToPath(new URL("../.output/firefox-mv3", import.meta.url))
const results = fileURLToPath(new URL("../results/", import.meta.url))
const origin = "http://127.0.0.1:47810"
const uuid = "6f1c2a52-8d3e-4a1b-9c55-0e2f6a7b8c90"
const base = `moz-extension://${uuid}`
const out = { browser: "firefox", dpr, headless }

const xpiDir = mkdtempSync(join(tmpdir(), "drop-spike-xpi-"))
const xpi = join(xpiDir, "drop-spike.xpi")
execFileSync("zip", ["-qr", xpi, "."], { cwd: source })

const options = new firefox.Options()
  .setBinary(binary)
  // A fixed moz-extension UUID, so the harness knows the extension's page URLs.
  .setPreference("extensions.webextensions.uuids", JSON.stringify({ "drop-spike@example.com": uuid }))
  .setPreference("layout.css.devPixelsPerPx", String(dpr))
if (headless) options.addArguments("-headless")
// Firefox 153+ refuses the chrome context and moz-extension:// navigation unless geckodriver passes
// --allow-system-access. Firefox 128 doesn't need it and ignores it.
const service = new firefox.ServiceBuilder().addArguments("--allow-system-access")
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build()
const caps = await driver.getCapabilities()
out.version = caps.get("browserVersion")
await driver.manage().window().setRect({ width: 800, height: 600 })
// installAddon() sends the XPI as base64 `addon`, which Firefox 128's Marionette rejects (InvalidArgumentError).
// Sending a `path` works on 128.
out.addonId = await driver.execute(
  new Command("install addon").setParameter("path", xpi).setParameter("temporary", true),
)

const chrome = async (fn) => {
  await driver.setContext(firefox.Context.CHROME)
  try {
    return await fn()
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}
// Runs in the extension's own page, so `browser.*` is available.
const ext = (script, ...args) => driver.executeAsyncScript(
  `const done = arguments[arguments.length - 1]; (async (...a) => { ${script} })(...Array.from(arguments).slice(0, -1)).then(done, (e) => done({ thrown: String(e) }))`,
  ...args,
)
const events = () => ext(`return (await browser.storage.local.get("events")).events ?? []`)
const clearEvents = () => ext(`await browser.storage.local.set({ events: [] })`)
const send = (message) => ext(`return browser.runtime.sendMessage(arguments[0])`, message)

async function clickAction() {
  await chrome(async () => {
    // The widget's id is on a wrapper; the popup opens from its inner action button.
    const button = await driver.findElement(
      By.css("#drop-spike_example_com-browser-action .unified-extensions-item-action-button"),
    )
    await button.click()
  })
}

// Key actions in the chrome context reach the browser window's <key> handlers, so the command fires.
async function pressCommand() {
  await chrome(() =>
    driver.actions().keyDown(Key.ALT).keyDown(Key.SHIFT).sendKeys("Y").keyUp(Key.SHIFT).keyUp(Key.ALT).perform(),
  )
}

async function waitForEvent(kind, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const hit = (await events()).find((e) => e.kind === kind)
    if (hit) return hit.detail
    await driver.sleep(250)
  }
  throw new Error(`${kind} never logged`)
}

async function acceptDoorhanger() {
  await chrome(async () => {
    const notification = await driver.wait(until.elementLocated(By.id("addon-webext-permissions-notification")), 5000)
    await driver.wait(until.elementIsVisible(notification), 5000)
    // The primary button is a <moz-button> that WebDriver can't scroll into view in the panel, so click it from script.
    const accept = await notification.findElement(By.css(".popup-notification-primary-button"))
    await driver.executeScript("arguments[0].click()", accept)
  })
}

// Tabs: [0] options page (extension), [1] the test page.
await driver.get(`${base}/options.html`)
const optionsHandle = await driver.getWindowHandle()
await driver.switchTo().newWindow("tab")
await driver.get(`${origin}/page`)
const tabHandle = await driver.getWindowHandle()
const toOptions = () => driver.switchTo().window(optionsHandle)
const toTab = () => driver.switchTo().window(tabHandle)
await toOptions()
const tabId = await ext(`return Math.max(...(await browser.tabs.query({})).map((t) => t.id))`)
out.tabId = tabId
out.startupEvents = await events()

// Row 7: options page with the network offline.
out.row7 = await step("offline icon", async () => {
  await chrome(() => driver.executeScript("Services.io.offline = true; Services.io.manageOfflineStatus = false"))
  try {
    await driver.navigate().refresh()
    const icon = await driver.wait(until.elementLocated(By.css("svg#icon path")), 5000)
    const paths = await driver.executeScript("return document.querySelectorAll('#icon path').length")
    const buttonIconPaths = await driver.executeScript("return document.querySelectorAll('#grant svg path').length")
    const offline = await driver.executeScript("return navigator.onLine === false")
    writeFileSync(join(results, `firefox-options-offline-dpr${dpr}.png`), await driver.takeScreenshot(), "base64")
    return { iconFound: Boolean(icon), paths, buttonIconPaths, navigatorOffline: offline }
  } finally {
    await chrome(() => driver.executeScript("Services.io.offline = false"))
  }
}, 15_000)

// Row 1: permissions.request on a user gesture, then accept the doorhanger.
out.row1 = await step("permissions.request", async () => {
  await driver.findElement(By.id("grant")).click()
  await acceptDoorhanger()
  await driver.wait(async () => (await driver.findElement(By.id("result")).getText()) !== "", 10_000)
  return JSON.parse(await driver.findElement(By.id("result")).getText())
}, 25_000)

out.row2 = {}
await clearEvents()
out.row2.noGesture = await step("inject without gesture", () => send({ type: "inject", tabId, via: "no-gesture" }))

out.row2.chromeKeyCommand = await step("Alt+Shift+Y sent to the browser window (chrome context actions)", async () => {
  await clearEvents()
  await toTab()
  await pressCommand()
  // Stay on the tab while the command runs: switching back to the options tab makes it the active tab, and
  // captureVisibleTab then fails with "Missing activeTab permission".
  await driver.sleep(2000)
  await toOptions()
  return waitForEvent("popup-run")
}, 20_000)

if (!headless) {
  out.row2.xtestCommand = await step("Alt+Shift+Y as a real X key press", async () => {
    await clearEvents()
    await toTab()
    execFileSync("python3", [fileURLToPath(new URL("./xkey.py", import.meta.url)), "alt+shift+y"])
    await driver.sleep(2000)
    await toOptions()
    return (await events()).filter((e) => e.kind === "command" || e.kind === "inject")
  })
}

if (out.row2.chromeKeyCommand.ok) {
  const shot = out.row2.chromeKeyCommand.value.capture
  await toTab()
  const viewport = await driver.executeScript("return { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }")
  out.row3 = { viewport, image: typeof shot === "string" ? pngSize(shot) : shot }
  if (typeof shot === "string") {
    writeFileSync(join(results, `firefox-capture-dpr${dpr}.png`), Buffer.from(shot.split(",")[1], "base64"))
    out.row3.matches =
      out.row3.image.width === Math.round(viewport.w * viewport.dpr) &&
      out.row3.image.height === Math.round(viewport.h * viewport.dpr)
  }
  out.row2.chromeKeyCommand.value.capture = "see row3"
  await toOptions()
}

out.row2.toolbarClick = await step("toolbar button click (chrome context) opens the popup", async () => {
  await clearEvents()
  await toTab()
  await clickAction()
  await driver.sleep(2000)
  await toOptions()
  const run = await waitForEvent("popup-run").catch(async (error) => ({ error: error.message, events: await events() }))
  if (run.capture) run.capture = typeof run.capture === "string" ? "png" : run.capture
  return run
}, 20_000)

out.row2.beforeNav = await step("re-inject on the same page, no navigation", async () => {
  return send({ type: "inject", tabId, via: "before-nav" })
})

out.row2.sameOriginNav = await step("re-inject after same-origin navigation", async () => {
  await toTab()
  await driver.findElement(By.id("next")).click()
  await driver.wait(until.urlIs(`${origin}/page2`), 5000)
  await toOptions()
  return send({ type: "inject", tabId, via: "after-same-origin-nav" })
})
out.row2.crossOriginNav = await step("re-inject after cross-origin navigation", async () => {
  await toTab()
  await driver.get("http://localhost:47810/page")
  await toOptions()
  return send({ type: "inject", tabId, via: "after-cross-origin-nav" })
})

out.row4 = await step("shadow root on CSP page", async () => {
  await toTab()
  await driver.get(`${origin}/csp`)
  await toOptions()
  await clearEvents()
  await toTab()
  await pressCommand()
  await driver.wait(async () => driver.executeScript("return document.documentElement.dataset.dropSpike"), 10_000)
  return JSON.parse(await driver.executeScript("return document.documentElement.dataset.dropSpike"))
}, 20_000)

// SPIKE_GRANT_PATTERN: the origin pattern to grant. With the port (http://127.0.0.1:47810/*) Firefox 128 reports
// granted and contains, but executeScript still says "Missing host permission"; the default has no port.
out.row2.onUpdatedWithHost = await step("tabs.onUpdated with host permission", async () => {
  await toOptions()
  out.row2.grantPattern = process.env.SPIKE_GRANT_PATTERN ?? "http://127.0.0.1/*"
  await driver.get(`${base}/options.html?origin=${encodeURIComponent(out.row2.grantPattern)}`)
  await driver.findElement(By.id("grant")).click()
  await acceptDoorhanger()
  await driver.wait(async () => (await driver.findElement(By.id("result")).getText()) !== "", 10_000)
  const grant = JSON.parse(await driver.findElement(By.id("result")).getText())
  await clearEvents()
  await toTab()
  await driver.get(`${origin}/page`)
  await driver.sleep(1500)
  await toOptions()
  return { grant, events: (await events()).filter((e) => e.kind === "inject" || e.kind === "onUpdated") }
}, 30_000)

out.row5 = await step("launchWebAuthFlow", async () => {
  await toTab()
  await driver.get(`${origin}/session`)
  const sid = await driver.findElement(By.id("sid")).getText()
  await toOptions()
  const { url: redirect } = await send({ type: "redirect-url" })
  const result = await send({ type: "auth", url: `${origin}/auth?redirect_uri=${encodeURIComponent(redirect)}`, interactive: true })
  return { sid, redirect, result, sawCookie: result.url ? new URL(result.url).searchParams.get("code") === sid : false }
}, 30_000)

report(out, join(results, `firefox-dpr${dpr}${headless ? "" : "-headed"}.json`))
await driver.quit()
rmSync(xpiDir, { recursive: true, force: true })
