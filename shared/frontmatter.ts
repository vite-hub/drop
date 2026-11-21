const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/

export function splitFrontmatter(markdown: string) {
  const frontmatter = markdown.match(FRONTMATTER)?.[0] ?? ""
  return { frontmatter, body: markdown.slice(frontmatter.length).replace(/^(?:\r?\n)+/, "") }
}

export function joinFrontmatter(frontmatter: string, body: string) {
  const kept = frontmatter.replace(/^supersedes:.*(?:\r?\n|$)/m, "")
  const meta = /^---\r?\n---/.test(kept) ? "" : kept
  return (meta ? `${meta.replace(/(?:\r?\n)*$/, "\n")}\n` : "") + body.replace(/^(?:\r?\n)+/, "")
}
