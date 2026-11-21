export function siteTile(name: string): string {
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
