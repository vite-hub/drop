import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Builder, By, until } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"
import { Command } from "selenium-webdriver/lib/command.js"
import { HTTP_PORT, startFixture } from "./drop-fixture.mjs"
import { report, results, step } from "./util.mjs"

const binary = process.argv[2] ?? process.env.DROP_E2E_FIREFOX
if (!binary) throw new Error("Pass the Firefox binary: node harness/onboarding-firefox.mjs <path>")
const headless = process.env.DROP_E2E_HEADED !== "1"
const source = fileURLToPath(new URL("../.output/firefox-mv3", import.meta.url))
const shots = join(results, "onboarding")
const out = { browser: "firefox", checks: {} }
mkdirSync(shots, { recursive: true })

const fixture = await startFixture()
const xpiDir = mkdtempSync(join(tmpdir(), "drop-onboarding-xpi-"))
const xpi = join(xpiDir, "drop.xpi")
execFileSync("zip", ["-qr", xpi, "."], { cwd: source })

const options = new firefox.Options().setBinary(binary).windowSize({ width: 960, height: 1000 })
if (headless) options.addArguments("-headless")
const service = new firefox.ServiceBuilder().addArguments("--allow-system-access")
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build()

const button = (name) => driver.findElement(By.xpath(`//button[normalize-space()="${name}"]`))
const statusText = () => driver.findElement(By.css("[data-testid=drop-status]")).getText()

try {
  out.version = (await driver.getCapabilities()).get("browserVersion")
  await driver.execute(new Command("install addon").setParameter("path", xpi).setParameter("temporary", true))

  out.checks.welcome = await step("the welcome tab renders", async () => {
    for (;;) {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle)
        const url = await driver.getCurrentUrl()
        if (url.startsWith("moz-extension://") && url.endsWith("/welcome.html")) {
          const heading = await driver.wait(until.elementLocated(By.css("h1")), 5000)
          return { url, heading: await heading.getText() }
        }
      }
      await driver.sleep(250)
    }
  })

  out.checks.check = await step(
    "step 2 finds a Drop on this computer",
    async () => {
      await driver.executeScript(() => {
        Object.defineProperty(globalThis.browser.permissions, "request", {
          configurable: true,
          value: async () => true,
        })
      })
      await button("Get started").click()
      await driver.findElement(By.xpath(`//label[contains(., "My own Drop")]`)).click()
      await driver.findElement(By.css("#drop-address")).sendKeys(`http://localhost:${HTTP_PORT}`)
      await button("Check").click()
      await driver.wait(async () => (await statusText()).startsWith("Found"), 10_000)
      const text = await statusText()
      writeFileSync(join(shots, "welcome-2-found-firefox.png"), await driver.takeScreenshot(), "base64")
      if (text !== `Found Acme Drop at localhost:${HTTP_PORT}.`) throw new Error(text)
      return text
    },
    20_000,
  )

  out.checks.pin = await step(
    "step 5 tells Firefox users where the button is",
    async () => {
      await button("Continue").click()
      await button("Skip for now").click()
      await button("Continue").click()
      const text = await driver.wait(until.elementLocated(By.css("[data-step=try]")), 5000).getText()
      writeFileSync(join(shots, "welcome-5-firefox.png"), await driver.takeScreenshot(), "base64")
      if (!text.includes("Customize Toolbar") || text.includes("puzzle piece")) throw new Error(text)
      return "Customize Toolbar"
    },
    20_000,
  )
} finally {
  await driver.quit()
  fixture.close()
  rmSync(xpiDir, { recursive: true, force: true })
}

report(out, "onboarding-firefox")
