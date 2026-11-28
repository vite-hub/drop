// Row 8, option A: can puppeteer-core (WebDriver BiDi) install the extension into Firefox 128 ESR?
// Usage: node harness/probe-puppeteer-firefox.mjs <path to firefox binary>
import { fileURLToPath } from "node:url"
import puppeteer from "puppeteer-core"

const executablePath = process.argv[2]
const extension = fileURLToPath(new URL("../.output/firefox-mv3", import.meta.url))
const browser = await puppeteer.launch({ browser: "firefox", executablePath, headless: true })
console.log("version", await browser.version())
try {
  const id = await browser.installExtension(extension)
  console.log("installExtension ok", id)
} catch (error) {
  console.log("installExtension failed:", error.message)
}
await browser.close()
