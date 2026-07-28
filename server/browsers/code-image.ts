const RAY_URL = "https://ray.so/"
export const MAX_CODE_CHARACTERS = 20_000

export interface CodeImageInput {
  code: string
  language?: string
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

export default defineBrowser(async (input: CodeImageInput, { browser }) => {
  if (!input.code || input.code.length > MAX_CODE_CHARACTERS)
    throw new TypeError(`[drop:code-image] Code must contain between 1 and ${MAX_CODE_CHARACTERS} characters.`)

  const session = await browser.open()
  await session.page.goto(RAY_URL, { waitUntil: "domcontentloaded" })
  const editor = session.page.locator('textarea[data-enable-grammarly="false"]')
  await editor.waitFor({ state: "visible" })
  await editor.fill(input.code)

  if (input.theme)
    await selectRayOption(session.page, "background", input.theme)
  if (input.language)
    await selectRayOption(session.page, "language", input.language)

  await session.page.addStyleTag({
    content: '[class*="windowSizeDragPoint"] { display: none !important; }',
  })
  const frame = session.page.locator("#frame")
  await frame.waitFor({ state: "visible" })
  return await frame.screenshot({ type: "png" })
})
