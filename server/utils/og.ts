import { eq, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { dropTexts } from "../databases/config"
import type { DropKind } from "#shared/types"
import { SEARCH_KINDS, searchableText } from "./search"
import type { DropRow } from "./drops/types"
import { escapeUTF8 as escapeHtml } from "entities"

// A shared link's preview (Open Graph): the drop's title, a line of what it says, and a card image of both.

/** About two lines in a chat app's preview. */
const EXCERPT_LENGTH = 200

// Search text keeps what a snippet can live with: callout markers (`[!NOTE]`), and a space where bold met a comma.
const clip = (text: string, length: number) => {
  const line = text
    .replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?)])/g, "$1")
    .trim()
  if (line.length <= length) return line
  return `${line.slice(0, length).replace(/\s+\S*$/, "")}…`
}

/**
 * The line under a preview's title: a doc's first words, a folder's description, a site's address. `source` is a
 * Markdown or HTML doc's text when the caller already read it; otherwise its search text answers, for latest versions.
 */
export async function dropExcerpt(row: DropRow, source?: string) {
  let text: string | null | undefined
  if (row.kind === "folder") text = row.note
  else if (row.kind === "site") text = row.siteUrl
  else if (source !== undefined && (row.kind === "markdown" || row.kind === "html"))
    text = searchableText(row.kind, source)
  else if (SEARCH_KINDS.some((kind) => kind === row.kind)) {
    const [found] = await db
      .select({ text: sql<string>`substr(${dropTexts.text}, 1, ${EXCERPT_LENGTH * 2})` })
      .from(dropTexts)
      .where(eq(dropTexts.dropId, row.id))
      .limit(1)
    text = found?.text
  }
  return text ? clip(text, EXCERPT_LENGTH) || undefined : undefined
}

const CARD_KINDS: Record<DropKind, string> = {
  markdown: "Doc",
  html: "Page",
  image: "Image",
  file: "File",
  app: "App",
  folder: "Folder",
  site: "Site review",
  board: "Board",
}

export interface OgCard {
  title: string
  excerpt?: string
  kind: DropKind
  version: number
  date: number
}

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/**
 * The card as a page for Browser Run to screenshot, in the look of /og.png: dark, a dot grid, Geist. The hand comes
 * from this Drop's favicon and the font from Google Fonts, so the screenshot waits for the network to settle.
 */
export function ogCardHtml(card: OgCard, origin: string) {
  const size = card.title.length <= 40 ? 76 : card.title.length <= 90 ? 60 : 48
  const date = new Date(card.date).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })
  const meta = [CARD_KINDS[card.kind], card.version > 1 ? `v${card.version}` : "", date].filter(Boolean)
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=block">
<style>
*{box-sizing:border-box;margin:0}
html,body{width:${OG_WIDTH}px;height:${OG_HEIGHT}px}
body{background:#0a0a0a radial-gradient(#ffffff14 1px,transparent 1px) 0 0/24px 24px;color:#fafafa;font-family:Geist,ui-sans-serif,system-ui,sans-serif;padding:72px 80px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;letter-spacing:-.01em}
.brand img{width:44px;height:44px}
.brand span{color:#71717a;font-weight:400}
main{margin-top:auto;margin-bottom:auto;display:flex;flex-direction:column;gap:24px}
h1{font-size:${size}px;line-height:1.08;font-weight:600;letter-spacing:-.025em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
p{font-size:28px;line-height:1.4;color:#a1a1aa;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
footer{display:flex;gap:12px;font-size:22px;color:#a1a1aa}
footer span{border:1px solid #27272a;background:#18181b;border-radius:999px;padding:6px 16px}
</style></head><body>
<div class="brand"><img src="${escapeHtml(new URL("/favicon.svg", origin).href)}" alt="">Drop <span>/ ViteHub</span></div>
<main><h1>${escapeHtml(card.title)}</h1>${card.excerpt ? `<p>${escapeHtml(card.excerpt)}</p>` : ""}</main>
<footer>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</footer>
</body></html>`
}

/** Bump when the card's look changes: every cached card renders again on its next request. */
const CARD_VERSION = 1

/** A cached card's key: it changes with whatever the card shows, so a renamed drop gets a new card. */
export async function ogCardKey(id: string, card: OgCard) {
  const bytes = new TextEncoder().encode(JSON.stringify([CARD_VERSION, card]))
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  const hash = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `og:${id}:${hash}`
}
