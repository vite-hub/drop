// Site review: a site drop stands for a live website (a preview deploy, staging, a dev server). Its pages load Drop's
// review script, and what people send from there lands in Drop as comments with screenshots.

/** How long a review token lasts. The connect popup issues a new one when it runs out. */
export const REVIEW_TOKEN_HOURS = 12

/** The longest page address a review comment keeps: path, query, and hash. */
export const MAX_REVIEW_PAGE = 1000

/**
 * The origin a site drop accepts comments from, or null when `url` can't be one. Only https, except plain http on
 * this computer (localhost, 127.0.0.1, *.localhost), where dev servers run.
 */
export function siteOrigin(url: string): string | null {
  let parsed: URL
  try { parsed = new URL(url.trim()) }
  catch { return null }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol === "https:") return parsed.origin
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname.endsWith(".localhost")
  return parsed.protocol === "http:" && local ? parsed.origin : null
}

/** The tag a site adds to the pages people review. `dropOrigin` is this Drop; `link` is the site drop's link key. */
export const reviewSnippet = (dropOrigin: string, link: string) =>
  `<script src="${dropOrigin}/review.js" data-drop="${link}" defer></script>`
