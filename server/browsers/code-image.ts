const RAY_URL = "https://ray.so/"

export interface CodeImageInput {
  code: string
  format?: CodeImageFormat
  language?: string
  scale?: CodeImageScale
  theme?: string
}

function createRayUrl(input: CodeImageInput) {
  const state = new URLSearchParams()
  if (input.theme)
    state.set("theme", input.theme)
  if (input.language)
    state.set("language", input.language)
  const hash = state.toString()
  return hash ? `${RAY_URL}#${hash}` : RAY_URL
}

async function assertRayOption(
  page: BrowserPage,
  name: string,
  marker: string,
  id: string,
) {
  const control = page.locator(`input[value*=${JSON.stringify(`"${marker}"`)}]`)
  if (await control.count() !== 1)
    throw new Error(`[drop:code-image] Ray ${name} control was not found.`)

  const selected = JSON.parse(await control.inputValue()) as { id?: unknown }
  if (selected.id !== id)
    throw new Error(`[drop:code-image] Ray does not offer ${name} ${JSON.stringify(id)}.`)
}

async function openRayExportMenu(page: BrowserPage) {
  const button = page.locator('button[aria-label="See other export options"]')
  if (await button.count() !== 1)
    throw new Error("[drop:code-image] Ray export menu was not found.")
  await button.click()
}

async function selectRayExportScale(
  page: BrowserPage,
  scale: CodeImageScale,
) {
  await openRayExportMenu(page)
  const size = page.locator('[role="menuitem"]', { hasText: "Size" })
  if (await size.count() !== 1)
    throw new Error("[drop:code-image] Ray export size control was not found.")
  await size.click()

  const option = page.locator('[role="menuitemradio"]', { hasText: `${scale}x` })
  if (await option.count() !== 1)
    throw new Error(`[drop:code-image] Ray does not offer ${scale}x export.`)
  await option.click()

  await openRayExportMenu(page)
  const selected = page.locator('[role="menuitem"]', { hasText: `Size ${scale}x` })
  if (await selected.count() !== 1)
    throw new Error(`[drop:code-image] Ray did not select ${scale}x export.`)
  await page.press("Escape")
}

function readRayDownload(download: BrowserDownload) {
  const separator = download.url.indexOf(",")
  if (!download.url.startsWith("data:") || separator === -1)
    throw new Error("[drop:code-image] Ray returned an empty export.")

  const metadata = download.url.slice(5, separator)
  const content = download.url.slice(separator + 1)
  const decoded = metadata.includes(";base64")
    ? Buffer.from(content, "base64")
    : Buffer.from(decodeURIComponent(content))
  if (!decoded.length)
    throw new Error("[drop:code-image] Ray returned an empty export.")
  return decoded
}

async function exportRayImage(
  page: BrowserPage,
  format: CodeImageFormat,
) {
  const download = await page.waitForDownload(async () => {
    if (format === "png") {
      const button = page.locator('button[aria-label="Export as PNG"]', { hasText: "Export Image" })
      if (await button.count() !== 1)
        throw new Error("[drop:code-image] Ray PNG export was not found.")
      await button.click()
    }
    else {
      await openRayExportMenu(page)
      const item = page.locator('[role="menuitem"]', { hasText: "Save SVG" })
      if (await item.count() !== 1)
        throw new Error("[drop:code-image] Ray SVG export was not found.")
      await item.click()
    }
  })

  if (!download.suggestedFilename.endsWith(`.${format}`))
    throw new Error(`[drop:code-image] Ray returned an unexpected ${format} export.`)

  const image = readRayDownload(download)
  if (format === "png" && !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("[drop:code-image] Ray returned an invalid PNG export.")
  if (format === "svg" && !image.subarray(0, 512).toString("utf8").includes("<svg"))
    throw new Error("[drop:code-image] Ray returned an invalid SVG export.")
  return image
}

export default defineBrowser(async (input: CodeImageInput, { browser }) => {
  if (!input.code || input.code.length > CODE_IMAGE_MAX_CHARACTERS)
    throw new TypeError(`[drop:code-image] Code must contain between 1 and ${CODE_IMAGE_MAX_CHARACTERS} characters.`)

  const format = input.format ?? "png"
  const scale = input.scale ?? 4
  const { page } = await browser.open()
  await page.goto(createRayUrl(input))
  const editor = page.locator('textarea[data-enable-grammarly="false"]')
  await editor.waitFor()
  if (input.theme)
    await assertRayOption(page, "theme", "background", input.theme)
  if (input.language)
    await assertRayOption(page, "language", "language", input.language)
  await editor.fill(input.code)

  const padding = page.locator('button[aria-label="16"]')
  if (await padding.count() !== 1)
    throw new Error("[drop:code-image] Ray padding control was not found.")
  await padding.click()

  await selectRayExportScale(page, scale)
  return await exportRayImage(page, format)
})
