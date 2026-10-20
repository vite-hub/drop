import type { ThemedToken } from "shiki/core"
import { type CodeTheme, isCodeTheme, loadHighlighter } from "#shared/highlighter"

/**
 * Code images, rendered here instead of scraped from another site: Shiki tokenizes the code, and the tokens
 * become a self-contained SVG with a ray.so-style window. PNGs are a browser screenshot of that SVG.
 */

const DEFAULT_CODE_THEME: CodeTheme = "github-dark"

/** Theme names agents learned from the old Ray.so renderer keep working. */
const THEME_ALIASES = new Map<string, CodeTheme>([
  ["nuxt", "vitesse-dark"],
  ["midnight", "night-owl"],
  ["vercel", "github-dark"],
  ["raycast", "one-dark-pro"],
  ["candy", "dracula"],
  ["breeze", "github-light"],
  ["mono", "github-dark"],
  ["noir", "github-dark"],
])

async function prepare(language: string | undefined, theme: string | undefined) {
  const themeName = (theme && (isCodeTheme(theme) ? theme : THEME_ALIASES.get(theme))) || DEFAULT_CODE_THEME
  const { shiki, lang } = await loadHighlighter(language, [themeName])
  return { shiki, lang, theme: themeName }
}

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (char) => `&${{ "<": "lt", ">": "gt", "&": "amp", '"': "quot", "'": "apos" }[char]};`)

const FONT_SIZE = 14
const LINE_HEIGHT = 22
const CHAR_WIDTH = 8.43 // A 14px monospace advance; the SVG is laid out without measuring text.
const FRAME = 32
const PADDING = 20
const BAR = 34

function tokenSpan(token: ThemedToken) {
  const style = token.fontStyle ?? 0
  const attrs = [
    token.color ? `fill="${token.color}"` : "",
    style & 1 ? `font-style="italic"` : "",
    style & 2 ? `font-weight="bold"` : "",
    style & 4 ? `text-decoration="underline"` : "",
  ]
    .filter(Boolean)
    .join(" ")
  return `<tspan ${attrs}>${escapeXml(token.content)}</tspan>`
}

/** A ray.so-style code card as SVG: gradient frame, window with traffic lights, highlighted code. */
export async function renderCodeSvg(input: { code: string; language?: string; theme?: string }) {
  const { shiki, lang, theme } = await prepare(input.language, input.theme)
  const code = input.code.replace(/\t/g, "  ").replace(/\s+$/, "")
  const { tokens, bg = "#0d1117", fg = "#e6edf3" } = shiki.codeToTokens(code, { lang, theme })
  const columns = Math.max(24, ...code.split("\n").map((line) => line.length))
  const windowWidth = Math.ceil(columns * CHAR_WIDTH) + PADDING * 2
  const windowHeight = BAR + tokens.length * LINE_HEIGHT + PADDING
  const width = windowWidth + FRAME * 2
  const height = windowHeight + FRAME * 2
  const lines = tokens.map(
    (line, index) =>
      `<text x="${FRAME + PADDING}" y="${FRAME + BAR + 4 + (index + 0.75) * LINE_HEIGHT}" xml:space="preserve">${line.map(tokenSpan).join("")}</text>`,
  )

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs>
<rect width="${width}" height="${height}" rx="16" fill="url(#frame)"/>
<rect x="${FRAME}" y="${FRAME}" width="${windowWidth}" height="${windowHeight}" rx="12" fill="${bg}"/>
${[0, 1, 2].map((dot) => `<circle cx="${FRAME + PADDING + dot * 20}" cy="${FRAME + BAR / 2 + 2}" r="6" fill="${["#ff5f57", "#febc2e", "#28c840"][dot]}"/>`).join("")}
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${FONT_SIZE}" fill="${fg}">
${lines.join("\n")}
</g>
</svg>`
  return { svg, width, height }
}

const CODE_IMAGE_PREFIX = "code-images/"
const CODE_IMAGE_TTL_MS = 5 * 60 * 1000

/** Code images are public and short-lived: the expiry is part of the key, and an hourly schedule sweeps them. */
export function createCodeImageLocation(format: "png" | "svg", now = new Date()) {
  const expiresAt = new Date(now.getTime() + CODE_IMAGE_TTL_MS)
  return { expiresAt, key: `${CODE_IMAGE_PREFIX}${expiresAt.getTime()}/${crypto.randomUUID()}.${format}` }
}

export function isExpiredCodeImage(pathname: string, now: Date) {
  if (!pathname.startsWith(CODE_IMAGE_PREFIX)) return false
  const expiryEnd = pathname.indexOf("/", CODE_IMAGE_PREFIX.length)
  if (expiryEnd === -1) return false
  const expiresAt = Number(pathname.slice(CODE_IMAGE_PREFIX.length, expiryEnd))
  return Number.isSafeInteger(expiresAt) && expiresAt <= now.getTime()
}
