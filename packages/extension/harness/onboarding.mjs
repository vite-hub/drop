import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { startFixture } from "./drop-fixture.mjs"
import { report, results, step } from "./util.mjs"

const extension = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const headless = process.env.DROP_E2E_HEADED !== "1"
const shots = join(results, "onboarding")
const out = { browser: "chromium", checks: {}, shots: [] }
mkdirSync(shots, { recursive: true })

const ACCOUNT = {
  drop: "https://drop.example.com",
  clientId: "client-1",
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  expiresAt: Date.now() + 3_600_000,
  name: "Ada Example",
  email: "ada@example.com",
}

function allowEverything() {
  for (const api of [globalThis.chrome, globalThis.browser]) {
    if (!api?.permissions) continue
    Object.defineProperty(api.permissions, "request", { configurable: true, value: async () => true })
  }
}

async function launch(scheme) {
  const profile = mkdtempSync(join(tmpdir(), "drop-onboarding-"))
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless,
    colorScheme: scheme,
    locale: "en-US",
    env: { ...process.env, LANG: "en_US.UTF-8", LANGUAGE: "en_US" },
    viewport: { width: 960, height: 1000 },
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--lang=en-US",
      "--enable-unsafe-extension-debugging",
      "--ignore-certificate-errors",
      `--host-resolver-rules=${fixture.hostRules}`,
    ],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const id = new URL(worker.url()).host
  const seed = (values) => worker.evaluate((data) => chrome.storage.local.set(data), values)
  const close = async () => {
    await context.close()
    rmSync(profile, { recursive: true, force: true })
  }
  return { context, worker, id, seed, close }
}

async function open(context, url) {
  const page = context.pages().find((item) => item.url() === url) ?? (await context.newPage())
  if (page.url() !== url) await page.goto(url)
  await page.waitForSelector("h1, main")
  await page.evaluate(allowEverything)
  return page
}

async function shot(page, name, options = {}) {
  await page.waitForTimeout(150)
  const path = join(shots, `${name}.png`)
  await page.screenshot({ path, ...options })
  out.shots.push(path)
}

const button = (page, name) => page.getByRole("button", { name, exact: true })

async function checkOwn(page, address) {
  await page.getByRole("radio", { name: /My own Drop/ }).click()
  await page.locator("#drop-address").fill(address)
  await button(page, "Check").click()
  await page.waitForFunction(
    () => !/Checking|Choose Allow in/.test(document.querySelector("[data-testid=drop-status]")?.textContent ?? ""),
  )
}

async function screens(scheme) {
  const { context, id, seed, close } = await launch(scheme)
  try {
    const welcomeUrl = `chrome-extension://${id}/welcome.html`
    const page = await open(context, welcomeUrl)
    const tag = (name) => `${name}-${scheme}`

    await shot(page, tag("welcome-1"))
    await button(page, "Get started").click()
    await shot(page, tag("welcome-2"))
    for (const [name, address] of [
      ["not-a-drop", "www.example.com"],
      ["outdated", "old.example.com"],
      ["elsewhere", "acme.example.com"],
      ["unreachable", "drop.exmaple.com"],
      ["found", "drop.example.com"],
    ]) {
      await checkOwn(page, address)
      await shot(page, tag(`welcome-2-${name}`))
    }
    await button(page, "Continue").click()
    await page.getByText("Connect to your Drop").waitFor()
    await shot(page, tag("welcome-3"))
    await button(page, "Skip for now").click()
    await page.getByRole("radio", { name: /On every page/ }).click()
    await shot(page, tag("welcome-4"))
    await page.getByRole("radio", { name: /Only when I press/ }).click()
    await button(page, "Continue").click()
    await page.getByText("Keep Drop one click away.").waitFor()
    await shot(page, tag("welcome-5"))

    await seed({ link: ACCOUNT, kept: ["https://www.example.com", "https://acme.example.com"] })
    await page.reload()
    await page.evaluate(allowEverything)
    await button(page, "Get started").click()
    await button(page, "Continue").click()
    await page.getByText("You're connected").waitFor()
    await shot(page, tag("welcome-3-connected"))

    const options = await open(context, `chrome-extension://${id}/options.html`)
    await options.getByText("Connected as Ada Example").waitFor()
    await shot(options, tag("options"), { fullPage: true })

    const site = await context.newPage()
    await site.goto("https://www.example.com/pricing")
    await site.bringToFront()
    const session = await context.browser().newBrowserCDPSession()
    const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab" }] })
    const target = targetInfos.find((info) => info.url.startsWith("https://www.example.com/"))
    await session.send("Extensions.triggerAction", { id, targetId: target.targetId })
    const popup = await context.newPage()
    await popup.setViewportSize({ width: 320, height: 420 })
    await popup.addInitScript(() => {
      const query = chrome.tabs.query.bind(chrome.tabs)
      chrome.tabs.query = async (filter) => {
        if (!filter?.active) return query(filter)
        const tabs = await query({ url: "https://www.example.com/*" })
        return tabs.slice(0, 1)
      }
    })
    await popup.goto(`chrome-extension://${id}/popup.html`)
    await popup.waitForSelector("[data-testid=site]")
    await popup.waitForTimeout(300)
    await shot(popup, tag("popup"), { fullPage: true })
    return { site: await popup.getByTestId("site").textContent() }
  } finally {
    await close()
  }
}

async function focusOn(page, name, limit = 20) {
  for (let presses = 1; presses <= limit; presses++) {
    await page.keyboard.press("Tab")
    const label = await page.evaluate(() => {
      const element = document.activeElement
      return (element?.getAttribute("aria-label") ?? element?.textContent ?? "").trim()
    })
    if (label === name) return presses
  }
  throw new Error(`Tab never reached ${name}`)
}

async function arrow(page, key) {
  await page.keyboard.down(key)
  await page
    .waitForFunction(() => document.activeElement?.getAttribute("aria-checked") === "true", null, { timeout: 2000 })
    .catch(() => {})
  await page.keyboard.up(key)
}

async function keyboard() {
  const { context, id, close } = await launch("light")
  let page
  try {
    page = await open(context, `chrome-extension://${id}/welcome.html`)
    const presses = {}
    const heading = async () => (await page.locator("h1").textContent()).trim()
    const focusedHeading = () => page.evaluate(() => document.activeElement?.tagName === "H1")

    presses.getStarted = await focusOn(page, "Get started")
    await page.keyboard.press("Enter")
    if ((await heading()) !== "Where is your Drop?" || !(await focusedHeading())) throw new Error("step 2 not focused")
    await page.keyboard.press("Tab")
    await arrow(page, "ArrowDown")
    if (!(await page.getByRole("radio", { name: /My own Drop/ }).isChecked())) throw new Error("arrows don't pick")
    await page.keyboard.press("Tab")
    await page.keyboard.type("drop.example.com")
    await page.keyboard.press("Enter")
    await page.getByText("Found Acme Drop at drop.example.com.").waitFor()
    presses.continue2 = await focusOn(page, "Continue")
    await page.keyboard.press("Enter")
    await page.getByText("Connect to your Drop").waitFor()
    presses.skip = await focusOn(page, "Skip for now")
    await page.keyboard.press("Enter")
    if ((await heading()) !== "Where should the hand show?") throw new Error("skip didn't reach step 4")
    await page.keyboard.press("Tab")
    await arrow(page, "ArrowDown")
    await page.getByTestId("hand-warning").waitFor()
    await arrow(page, "ArrowUp")
    if (!(await page.getByRole("radio", { name: /Only when I press/ }).isChecked()))
      throw new Error("ArrowUp didn't pick")
    presses.continue4 = await focusOn(page, "Continue")
    await page.keyboard.press("Enter")
    await page.getByText("Keep Drop one click away.").waitFor()
    presses.tryIt = await focusOn(page, "Try it on example.com")
    const tab = context.waitForEvent("page")
    await page.keyboard.press("Enter")
    await tab
    await page.getByText("Opened example.com in a new tab").waitFor()
    presses.back = await focusOn(page, "Back")
    await page.keyboard.press("Enter")
    if ((await heading()) !== "Where should the hand show?") throw new Error("Back didn't return")
    return presses
  } catch (error) {
    await page?.screenshot({ path: join(shots, "keyboard-failed.png") }).catch(() => {})
    const focused = await page?.evaluate(() => document.activeElement?.outerHTML.slice(0, 160)).catch(() => "")
    throw new Error(`${error.message} (focus: ${focused})`, { cause: error })
  } finally {
    await close()
  }
}

const fixture = await startFixture()
try {
  out.checks.light = await step("welcome, options and popup in light", () => screens("light"), 90_000)
  out.checks.dark = await step("welcome, options and popup in dark", () => screens("dark"), 90_000)
  out.checks.keyboard = await step("the welcome flow works with the keyboard alone", keyboard, 60_000)
} finally {
  fixture.close()
}

report(out, "onboarding")
