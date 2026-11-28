import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Builder, By, Origin } from "selenium-webdriver"
import logInspector from "selenium-webdriver/bidi/logInspector.js"
import firefox from "selenium-webdriver/firefox.js"
import { Command } from "selenium-webdriver/lib/command.js"
import { ACME, BLOCK, DROP, REVIEW, startDrop } from "./drop.mjs"
import { PORT, startServer } from "./server.mjs"
import { report, step } from "./util.mjs"

const binary = process.argv[2] ?? process.env.DROP_E2E_FIREFOX
if (!binary) throw new Error("Pass the Firefox binary: node harness/pill-firefox.mjs <path>")
const headless = process.env.DROP_E2E_HEADED !== "1"
const source = fileURLToPath(new URL("../.output-e2e/firefox-mv3", import.meta.url))
const out = { browser: "firefox", checks: {} }

const { fake, local } = await startDrop()
const server = await startServer(local)
const xpiDir = mkdtempSync(join(tmpdir(), "drop-e2e-pill-xpi-"))
const xpi = join(xpiDir, "drop.xpi")
execFileSync("zip", ["-qr", xpi, "."], { cwd: source })

const options = new firefox.Options()
  .setBinary(binary)
  .enableBidi()
  .setPreference("network.proxy.type", 1)
  .setPreference("network.proxy.http", "127.0.0.1")
  .setPreference("network.proxy.http_port", PORT)
  .setPreference("network.proxy.no_proxies_on", "")
  .setPreference("network.proxy.allow_hijacking_localhost", true)
  .setPreference("network.captive-portal-service.enabled", false)
if (headless) options.addArguments("-headless")
const service = new firefox.ServiceBuilder().addArguments("--allow-system-access")
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build()

const errors = []
const logs = await logInspector(driver)
await logs.onJavascriptException((entry) => errors.push(entry.text))
await logs.onConsoleEntry((entry) => {
  if (entry.level === "error") errors.push(entry.text)
})

const pause = (ms) => driver.sleep(ms)
async function until(check, what, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await pause(200)
  }
  throw new Error(`waited for ${what}`)
}

try {
  out.version = (await driver.getCapabilities()).get("browserVersion")
  const blank = await driver.getWindowHandle()
  await driver.execute(new Command("install addon").setParameter("path", xpi).setParameter("temporary", true))

  const welcome = await until(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle)
      if ((await driver.getCurrentUrl()).endsWith("/welcome.html")) return handle
    }
    return undefined
  }, "the welcome tab")

  async function background(type, payload = {}) {
    await driver.switchTo().window(welcome)
    const reply = await driver.executeAsyncScript(
      async (kind, fields, done) =>
        done(
          await browser.runtime
            .sendMessage({ ...fields, type: kind })
            .catch((error) => ({ ok: false, error: String(error) })),
        ),
      type,
      payload,
    )
    if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`)
    return reply.value
  }

  out.checks.link = await step(
    "the extension links to the Drop through OAuth",
    async () => {
      await background("deployment.set", { drop: DROP })
      const linked = await background("link.start")
      if (!linked.ok) throw new Error(`not linked: ${linked.problem} ${linked.detail}`)
      const { state } = linked
      if (!state.account) throw new Error("not linked")
      return state.account
    },
    30_000,
  )

  const shadow = async () => (await driver.findElement(By.css("drop-review"))).getShadowRoot()
  const inside = async (css) => (await shadow()).findElement(By.css(css))

  out.checks.mount = await step(
    "the toolbar button mounts a styled pill",
    async () => {
      await driver.switchTo().window(blank)
      await driver.get(`${ACME}/pricing`)
      await driver.setContext(firefox.Context.CHROME)
      try {
        await driver
          .findElement(By.css("#drop_vitehub_dev-browser-action .unified-extensions-item-action-button"))
          .click()
      } finally {
        await driver.setContext(firefox.Context.CONTENT)
      }
      await driver.switchTo().window(blank)
      await until(
        () => driver.executeScript("return document.querySelectorAll('drop-review').length === 1"),
        "the pill",
      )
      await until(
        () =>
          driver.executeScript(
            "const b = document.querySelector('drop-review').shadowRoot.querySelector('[data-act=comment]'); return !!b && b.getBoundingClientRect().width > 0",
          ),
        "the Comment button",
      )
      const styled = await driver.executeScript(() => {
        const root = document.querySelector("drop-review").shadowRoot
        const rules = [...root.styleSheets].reduce((sum, sheet) => sum + sheet.cssRules.length, 0)
        const bar = root.querySelector("[data-act=comment]").getBoundingClientRect()
        return { rules, height: bar.height, width: bar.width }
      })
      if (styled.rules < 10 || styled.height > 60) throw new Error(`unstyled: ${JSON.stringify(styled)}`)
      return styled
    },
    30_000,
  )

  out.checks.comment = await step(
    "a comment goes through to the review, with a screenshot",
    async () => {
      await driver.switchTo().window(blank)
      await (await inside("[data-act=comment]")).click()
      await driver
        .actions()
        .move({ x: BLOCK.left + BLOCK.width / 2, y: BLOCK.top + BLOCK.height / 2, origin: Origin.VIEWPORT })
        .click()
        .perform()
      await until(
        () =>
          driver.executeScript("return !document.querySelector('drop-review').shadowRoot.querySelector('.pop').hidden"),
        "the note",
      )
      await (await inside(".pop textarea")).sendKeys("Bigger block")
      await (await inside(".pop [type=submit]")).click()
      const thread = await until(() => (fake.threads.get(REVIEW.id) ?? [])[0], "the comment in the review")
      if (thread.body !== "Bigger block") throw new Error(JSON.stringify(thread))
      const shot = thread.screenshot ? fake.shots.get(thread.screenshot) : undefined
      return { n: thread.n, screenshot: shot ? `${shot.byteLength} bytes` : null }
    },
    30_000,
  )

  out.checks.noStyleErrors = await step("no adoptedStyleSheets errors", async () => {
    const built = readFileSync(join(source, "content-scripts/review.js"), "utf8")
    if (built.includes("adoptedStyleSheets")) throw new Error("the build sets adoptedStyleSheets")
    const found = errors.filter((text) => /adoptedStyleSheets/i.test(text))
    if (found.length) throw new Error(found.join("; "))
    return { errors: errors.length, sample: errors.slice(0, 5) }
  })
} finally {
  await driver.quit()
  server.close()
  rmSync(xpiDir, { recursive: true, force: true })
}

report(out, "pill-firefox")
