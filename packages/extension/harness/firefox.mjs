import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Builder, By } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"
import { Command } from "selenium-webdriver/lib/command.js"
import { PORT, SITES, startServer } from "./server.mjs"
import { report, step } from "./util.mjs"

const binary = process.argv[2] ?? process.env.DROP_E2E_FIREFOX
if (!binary) throw new Error("Pass the Firefox binary: node harness/firefox.mjs <path>")
const headless = process.env.DROP_E2E_HEADED !== "1"
const source = fileURLToPath(new URL("../.output/firefox-mv3", import.meta.url))
const out = { browser: "firefox", checks: {} }

const server = await startServer()
const xpiDir = mkdtempSync(join(tmpdir(), "drop-e2e-xpi-"))
const xpi = join(xpiDir, "drop.xpi")
execFileSync("zip", ["-qr", xpi, "."], { cwd: source })

const options = new firefox.Options()
  .setBinary(binary)
  .setPreference("network.proxy.type", 1)
  .setPreference("network.proxy.http", "127.0.0.1")
  .setPreference("network.proxy.http_port", PORT)
  .setPreference("network.proxy.no_proxies_on", "")
  .setPreference("network.captive-portal-service.enabled", false)
if (headless) options.addArguments("-headless")
const service = new firefox.ServiceBuilder().addArguments("--allow-system-access")
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build()

const hosts = () => driver.executeScript("return document.querySelectorAll('drop-review').length")
const pause = (ms) => driver.sleep(ms)

try {
  out.version = (await driver.getCapabilities()).get("browserVersion")
  const blank = await driver.getWindowHandle()
  out.addonId = await driver.execute(
    new Command("install addon").setParameter("path", xpi).setParameter("temporary", true),
  )

  out.checks.welcome = await step("the welcome tab opens on install", async () => {
    for (;;) {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle)
        const url = await driver.getCurrentUrl()
        if (url.startsWith("moz-extension://") && url.endsWith("/welcome.html")) return url
      }
      await pause(250)
    }
  })

  out.checks.freshProfile = await step(
    "a fresh profile injects nothing on five sites",
    async () => {
      await driver.switchTo().window(blank)
      const found = []
      for (const url of SITES) {
        await driver.get(url)
        await pause(1000)
        found.push({ url, hosts: await hosts() })
      }
      if (found.some((h) => h.hosts !== 0)) throw new Error(`injected: ${JSON.stringify(found)}`)
      return found
    },
    40_000,
  )

  out.checks.toolbar = await step(
    "the toolbar button opens the popup, which injects <drop-review>",
    async () => {
      await driver.switchTo().window(blank)
      await driver.get(SITES[0])
      await driver.setContext(firefox.Context.CHROME)
      try {
        await driver
          .findElement(By.css("#drop_vitehub_dev-browser-action .unified-extensions-item-action-button"))
          .click()
      } finally {
        await driver.setContext(firefox.Context.CONTENT)
      }
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if ((await hosts()) > 0) return { hosts: await hosts() }
        await pause(250)
      }
      throw new Error("no <drop-review> after the click")
    },
    20_000,
  )
} finally {
  await driver.quit()
  server.close()
  rmSync(xpiDir, { recursive: true, force: true })
}

report(out, "firefox")
