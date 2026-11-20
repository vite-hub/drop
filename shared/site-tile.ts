/**
 * A site's letter tile, for a link whose site has no icon: the first letter of its name on a rounded square, in a hue
 * that stays the same for that name, so two sites without icons still look apart. The server serves it for a host no
 * provider knows (server/utils/favicons.ts), and a doc's frame draws it when an icon doesn't load (./doc-header.ts),
 * which takes this function's source: it uses nothing from outside its body.
 */
export function siteTile(name: string): string {
  // Eight hues 45° apart, so two tiles side by side differ clearly; the hash picks one.
  let hash = 0
  for (const char of name) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0
  const hue = 20 + 45 * (hash % 8)
  const letter = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="oklch(0.56 0.11 ${hue})"/><text x="8" y="8" dy=".36em" text-anchor="middle" fill="#fff" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="10" font-weight="600">${letter.replace(/[<&]/g, "")}</text></svg>`
}
