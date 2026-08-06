import { highlightText } from "@speed-highlight/core"

import type { ShjLanguage } from "@speed-highlight/core"

export interface CodeImageInput {
  code: string
  format?: CodeImageFormat
  language?: string
  scale?: CodeImageScale
  theme?: string
}

interface CodeTheme {
  background: string
  label: string
  panel: string
}

const DEFAULT_THEME: CodeTheme = {
  background: "linear-gradient(135deg, #111827, #312e81)",
  label: "#94a3b8",
  panel: "#0d1117",
}

const THEMES: Record<string, CodeTheme> = {
  breeze: {
    background: "linear-gradient(135deg, #38bdf8, #2563eb)",
    label: "#93c5fd",
    panel: "#0f172a",
  },
  candy: {
    background: "linear-gradient(135deg, #fb7185, #a855f7)",
    label: "#f5d0fe",
    panel: "#18111f",
  },
  midnight: DEFAULT_THEME,
  nuxt: {
    background: "linear-gradient(135deg, #00dc82, #36e4da 52%, #0047e1)",
    label: "#6ee7b7",
    panel: "#0f172a",
  },
  raindrop: {
    background: "linear-gradient(135deg, #22d3ee, #4f46e5)",
    label: "#a5b4fc",
    panel: "#111827",
  },
  sunset: {
    background: "linear-gradient(135deg, #fb923c, #e11d48 58%, #7e22ce)",
    label: "#fda4af",
    panel: "#1c1024",
  },
}

const LANGUAGE_ALIASES: Record<string, ShjLanguage> = {
  "c#": "c",
  "c++": "c",
  csharp: "c",
  cpp: "c",
  dockerfile: "docker",
  javascript: "js",
  jsx: "js",
  makefile: "make",
  markdown: "md",
  perl: "pl",
  plaintext: "plain",
  python: "py",
  rust: "rs",
  shell: "bash",
  text: "plain",
  tsx: "ts",
  typescript: "ts",
  zsh: "bash",
}

const SUPPORTED_LANGUAGES = new Set<ShjLanguage>([
  "asm", "bash", "bf", "c", "css", "csv", "diff", "docker", "git", "go", "html", "http", "ini", "java", "js", "jsdoc", "json", "leanpub-md", "log", "lua", "make", "md", "pl", "plain", "py", "regex", "rs", "sql", "todo", "toml", "ts", "uri", "xml", "yaml",
])

const SYNTAX_CSS = `
.shj-syn-cmnt{color:#8b949e;font-style:italic}
.shj-syn-deleted,.shj-syn-err,.shj-syn-kwd{color:#ff7b72}
.shj-syn-class{color:#ffa657}
.shj-syn-insert{color:#98c379}
.shj-syn-type,.shj-syn-oper,.shj-syn-num,.shj-syn-section,.shj-syn-var,.shj-syn-bool{color:#79c0ff}
.shj-syn-str{color:#a5d6ff}
.shj-syn-func{color:#d2a8ff}
`

function resolveLanguage(language: string | undefined): ShjLanguage {
  if (!language)
    return "plain"
  const normalized = language.toLowerCase()
  if (LANGUAGE_ALIASES[normalized])
    return LANGUAGE_ALIASES[normalized]
  return SUPPORTED_LANGUAGES.has(normalized as ShjLanguage) ? normalized as ShjLanguage : "plain"
}

function resolveTheme(theme: string | undefined) {
  return theme ? THEMES[theme.toLowerCase()] ?? DEFAULT_THEME : DEFAULT_THEME
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderDocument(input: CodeImageInput, highlighted: string) {
  const scale = (input.scale ?? 4) / 2
  const theme = resolveTheme(input.theme)
  const language = escapeHtml(input.language ?? "Code")
  const unit = (value: number) => `${Math.round(value * scale)}px`

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{min-width:1280px}
#capture{display:flex;align-items:center;width:1280px;min-height:720px;padding:${unit(56)};background:${theme.background};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.window{width:100%;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:${unit(18)};background:${theme.panel};box-shadow:0 ${unit(24)} ${unit(70)} rgba(0,0,0,.32)}
.toolbar{display:flex;align-items:center;height:${unit(58)};padding:0 ${unit(22)};border-bottom:1px solid rgba(255,255,255,.08)}
.dots{display:flex;gap:${unit(9)}}
.dot{width:${unit(11)};height:${unit(11)};border-radius:999px}
.dot:nth-child(1){background:#ff5f57}.dot:nth-child(2){background:#febc2e}.dot:nth-child(3){background:#28c840}
.language{margin-left:auto;color:${theme.label};font-size:${unit(13)};font-weight:600;letter-spacing:.04em;text-transform:uppercase}
pre{margin:0;padding:${unit(34)} ${unit(38)} ${unit(40)};overflow:hidden;color:#c9d1d9;font:${unit(19)}/${unit(30)} ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
${SYNTAX_CSS}
</style></head><body><div id="capture"><div class="window"><div class="toolbar"><div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><span class="language">${language}</span></div><pre><code>${highlighted}</code></pre></div></div></body></html>`
}

export default defineBrowser(async (input: CodeImageInput, { browser }) => {
  if (!input.code || input.code.length > CODE_IMAGE_MAX_CHARACTERS)
    throw new TypeError(`[drop:code-image] Code must contain between 1 and ${CODE_IMAGE_MAX_CHARACTERS} characters.`)

  const highlighted = await highlightText(input.code, resolveLanguage(input.language), false, { hideLineNumbers: true })
  const session = await browser.open()
  await session.page.setContent(renderDocument(input, highlighted), { waitUntil: "load" })
  const capture = session.page.locator("#capture")
  const size = await capture.evaluate(element => ({
    height: (element as HTMLElement).offsetHeight,
    width: (element as HTMLElement).offsetWidth,
  }))
  if (!size.height || !size.width)
    throw new Error("[drop:code-image] Kitesurf did not render the code image.")
  if ((input.format ?? "png") === "png")
    return Buffer.from(await session.page.screenshot({ animations: "disabled", fullPage: true, type: "png" }))

  const style = await session.page.locator("style").innerText()
  const content = await capture.innerHTML()
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${style}</style><div id="capture">${content}</div></div></foreignObject></svg>`)
})
