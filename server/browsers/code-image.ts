import type { Download } from "playwright-core"

import type { CodeImageFormat, CodeImageScale } from "../utils/code-images"

const RAY_URL = "https://ray.so/"
export const MAX_CODE_CHARACTERS = 20_000

export interface CodeImageInput {
  code: string
  format?: CodeImageFormat
  language?: string
  scale?: CodeImageScale
  theme?: string
}

async function selectRayOption(
  page: BrowserPageSession["page"],
  control: string,
  name: string,
) {
  const button = page.locator(`div:has(> input[value*=${JSON.stringify(`"${control}"`)}]) > button[role="combobox"]`)
  if (await button.count() !== 1)
    throw new Error(`[drop:code-image] Ray ${control} control was not found.`)

  await button.click()
  const option = page.getByRole("option", { exact: true, name })
  if (await option.count() !== 1)
    throw new Error(`[drop:code-image] Ray does not offer ${control} ${JSON.stringify(name)}.`)
  await option.click()
}

async function openRayExportMenu(page: BrowserPageSession["page"]) {
  const button = page.locator('button[aria-label="See other export options"]')
  if (await button.count() !== 1)
    throw new Error("[drop:code-image] Ray export menu was not found.")
  await button.click()
}

async function selectRayExportScale(
  page: BrowserPageSession["page"],
  scale: CodeImageScale,
) {
  if (scale === 4)
    return

  await openRayExportMenu(page)
  const size = page.getByRole("menuitem").filter({ hasText: "Size" })
  if (await size.count() !== 1)
    throw new Error("[drop:code-image] Ray export size control was not found.")
  await size.click()

  const option = page.getByRole("menuitemradio", { exact: true, name: `${scale}x` })
  if (await option.count() !== 1)
    throw new Error(`[drop:code-image] Ray does not offer ${scale}x export.`)
  await option.press("Enter")

  await openRayExportMenu(page)
  const selected = page.getByRole("menuitem", { exact: true, name: `Size ${scale}x` })
  if (await selected.count() !== 1)
    throw new Error(`[drop:code-image] Ray did not select ${scale}x export.`)
  await page.keyboard.press("Escape")
}

async function readRayDownload(download: Download) {
  const stream = await download.createReadStream()
  const streamed = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on("end", () => resolve(Buffer.concat(chunks)))
    stream.on("error", reject)
  })
  if (streamed.length)
    return streamed

  const url = download.url()
  const separator = url.indexOf(",")
  if (!url.startsWith("data:") || separator === -1)
    throw new Error("[drop:code-image] Ray returned an empty export.")

  const metadata = url.slice(5, separator)
  const content = url.slice(separator + 1)
  const decoded = metadata.includes(";base64")
    ? Buffer.from(content, "base64")
    : Buffer.from(decodeURIComponent(content))
  if (!decoded.length)
    throw new Error("[drop:code-image] Ray returned an empty export.")
  return decoded
}

async function exportRayImage(
  page: BrowserPageSession["page"],
  format: CodeImageFormat,
) {
  const downloadPromise = page.waitForEvent("download")

  if (format === "png") {
    const button = page.locator('button[aria-label="Export as PNG"]')
    if (await button.count() !== 1)
      throw new Error("[drop:code-image] Ray PNG export was not found.")
    await button.click()
  }
  else {
    await openRayExportMenu(page)
    const item = page.getByRole("menuitem").filter({ hasText: "Save SVG" })
    if (await item.count() !== 1)
      throw new Error("[drop:code-image] Ray SVG export was not found.")
    await item.click()
  }

  const download = await downloadPromise
  if (!download.suggestedFilename().endsWith(`.${format}`))
    throw new Error(`[drop:code-image] Ray returned an unexpected ${format} export.`)

  const image = await readRayDownload(download)
  if (format === "png" && !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("[drop:code-image] Ray returned an invalid PNG export.")
  if (format === "svg" && !image.subarray(0, 512).toString("utf8").includes("<svg"))
    throw new Error("[drop:code-image] Ray returned an invalid SVG export.")
  return image
}

export default defineBrowser(async (input: CodeImageInput, { browser }) => {
  if (!input.code || input.code.length > MAX_CODE_CHARACTERS)
    throw new TypeError(`[drop:code-image] Code must contain between 1 and ${MAX_CODE_CHARACTERS} characters.`)

  const format = input.format ?? "png"
  const scale = input.scale ?? 4
  const session = await browser.open()
  await session.page.goto(RAY_URL, { waitUntil: "domcontentloaded" })
  const editor = session.page.locator('textarea[data-enable-grammarly="false"]')
  await editor.waitFor({ state: "visible" })
  await editor.fill(input.code)

  const padding = session.page.locator('button[aria-label="16"]')
  if (await padding.count() !== 1)
    throw new Error("[drop:code-image] Ray padding control was not found.")
  await padding.click()

  if (input.theme)
    await selectRayOption(session.page, "background", input.theme)
  if (input.language)
    await selectRayOption(session.page, "language", input.language)

  await selectRayExportScale(session.page, scale)
  await session.page.addStyleTag({
    content: '[class*="windowSizeDragPoint"] { display: none !important; }',
  })
  const frame = session.page.locator("#frame")
  await frame.waitFor({ state: "visible" })
  return await exportRayImage(session.page, format)
})
