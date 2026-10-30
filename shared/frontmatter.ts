/** Leading YAML front matter, `---` fenced. Drop keeps it out of the live editor: it's metadata, not text. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/

/** The front matter block (with its fences, or "") and the body after it. */
export function splitFrontmatter(markdown: string) {
  const frontmatter = markdown.match(FRONTMATTER)?.[0] ?? ""
  return { frontmatter, body: markdown.slice(frontmatter.length).replace(/^(?:\r?\n)+/, "") }
}

/** Puts front matter back on an edited body. A `supersedes` line is dropped: the published version links itself. */
export function joinFrontmatter(frontmatter: string, body: string) {
  const kept = frontmatter.replace(/^supersedes:.*(?:\r?\n|$)/m, "")
  const meta = /^---\r?\n---/.test(kept) ? "" : kept
  return (meta ? `${meta.replace(/(?:\r?\n)*$/, "\n")}\n` : "") + body.replace(/^(?:\r?\n)+/, "")
}

/**
 * Comark components, block (`::name` … `::`) or inline (`:name[…]`, `:name{…}`), footnotes (`[^1]: …`), and
 * CriticMarkup (`{++ … ++}`) have no editor node; editing would lose them, so those docs stay read-only.
 * Returns what a doc uses, named as its author wrote it (`::question`, `:badge`, `footnotes`), in reading order.
 */
export function editorlessSyntax(markdown: string) {
  const found = new Set<string>()
  const pattern =
    /^\s*(?::{2,}([a-z][\w-]*)|(\[\^[^\]\s]+\]:))|(?:^|[^\w:]):([a-z][\w-]*)[[{]|(\{(?:\+\+|--|~~|==|>>))/gim
  for (const [, block, footnote, inline, critic] of splitFrontmatter(markdown).body.matchAll(pattern)) {
    found.add(block ? `::${block}` : inline ? `:${inline}` : footnote ? "footnotes" : critic ? "suggested edits" : "")
  }
  return [...found]
}

export const hasEditorlessSyntax = (markdown: string) => editorlessSyntax(markdown).length > 0
