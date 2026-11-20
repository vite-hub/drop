/**
 * A site's letter tile, for a link whose site has no icon: the first letter of its name on a rounded square lit from
 * above (a soft gradient, a light top edge, a dark rim, a faint shadow under the letter), so it reads as a small icon
 * beside real logos rather than a placeholder. Its hue stays the same for that name, so two sites without icons still
 * look apart. The server serves it for a host no provider knows (server/utils/favicons.ts), and a doc's frame draws it
 * when an icon doesn't load (./doc-header.ts), which takes this function's source: it uses nothing from outside its
 * body. Chosen from flat, tinted and aurora on drop vb7hqztte1e2.
 */
export function siteTile(name: string): string {
  // Eight hues around the wheel, skipping the muddy olive and brown that oklch gives near 90–120 at this lightness.
  const hues = [25, 55, 150, 185, 230, 265, 300, 340]
  let hash = 0
  for (const char of name) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0
  const hue = hues[hash % 8]
  const letter = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase().replace(/[<&]/g, "")
  const text = `x="8" y="8" dy=".36em" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="10" font-weight="600"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs>` +
    `<linearGradient id="f" x2="0" y2="1"><stop offset="0" stop-color="oklch(0.66 0.12 ${hue})"/><stop offset="1" stop-color="oklch(0.5 0.13 ${hue})"/></linearGradient>` +
    `<linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `</defs><rect width="16" height="16" rx="4" fill="url(#f)"/>` +
    `<rect x=".5" y=".5" width="15" height="15" rx="3.5" fill="none" stroke="url(#s)"/>` +
    `<rect x=".25" y=".25" width="15.5" height="15.5" rx="3.75" fill="none" stroke="#000" stroke-opacity=".16" stroke-width=".5"/>` +
    `<text ${text} fill="#000" fill-opacity=".18" transform="translate(0 .6)">${letter}</text>` +
    `<text ${text} fill="#fff">${letter}</text></svg>`
  )
}
