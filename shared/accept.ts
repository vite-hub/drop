/**
 * Whether an Accept header prefers Markdown to HTML: `text/markdown` with a higher q than `text/html` (or than
 * `text/*` and `*\/*` when HTML isn't named), or the same q and listed first. Browsers never name Markdown, so they
 * keep getting HTML.
 */
export function prefersMarkdown(accept: string) {
  const ranges = accept.split(",").map((part, index) => {
    const [type = "", ...params] = part.split(";").map((item) => item.trim().toLowerCase())
    const q = params.find((param) => param.startsWith("q="))
    return { type, q: q ? Number(q.slice(2)) || 0 : 1, index }
  })
  type Range = (typeof ranges)[number]
  const best = (...types: string[]): Range | undefined =>
    ranges.find((range) => range.type === types[0]) ?? (types.length > 1 ? best(...types.slice(1)) : undefined)
  const markdown = best("text/markdown")
  if (!markdown || markdown.q === 0) return false
  const html = best("text/html", "text/*", "*/*")
  return !html || markdown.q > html.q || (markdown.q === html.q && markdown.index < html.index)
}
