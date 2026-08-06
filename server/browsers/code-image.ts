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
  page: BrowserPageSession["page"],
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

function readRayDownload(download: { url(): string }) {
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

  const download: BrowserDownload = await downloadPromise
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
  if (!input.code || input.code.length > CODE_IMAGE_MAX_CHARACTERS)
    throw new TypeError(`[drop:code-image] Code must contain between 1 and ${CODE_IMAGE_MAX_CHARACTERS} characters.`)

  const format = input.format ?? "png"
  const scale = input.scale ?? 4
  const session = await browser.open()
  await session.page.goto(createRayUrl(input), { waitUntil: "domcontentloaded" })
  const editor = session.page.locator('textarea[data-enable-grammarly="false"]')
  try {
    await editor.waitFor({ state: "visible" })
  }
  catch (error) {
    const body = await session.page.locator("body").innerText().catch(() => "")
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nPage: ${body.slice(0, 2_000)}`)
  }
  if (input.theme)
    await assertRayOption(session.page, "theme", "background", input.theme)
  if (input.language)
    await assertRayOption(session.page, "language", "language", input.language)
  await editor.fill(input.code)

  const padding = session.page.locator('button[aria-label="16"]')
  if (await padding.count() !== 1)
    throw new Error("[drop:code-image] Ray padding control was not found.")
  await padding.click()

  await selectRayExportScale(session.page, scale)
  return exportRayImage(session.page, format)
})
