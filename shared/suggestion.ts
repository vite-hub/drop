/** A comment's suggested edit in words, for agents: what replaces the quote, or that it goes. Empty on a plain comment. */
export const suggestionLine = (suggestion: string | null | undefined, indent = "   ") =>
  suggestion == null
    ? ""
    : `\n${indent}${suggestion ? `Suggests replacing it with: ${suggestion.replace(/\n/g, `\n${indent}`)}` : "Suggests deleting it."}`

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Rendered text as Markdown would read it plainly: no emphasis, code ticks, or link targets. */
const plain = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Applies a suggestion to a Markdown body: the quote, as the page showed it, replaced by the suggested words. The quote
 * is matched with any run of whitespace standing for a line break in the source. When it's there more than once, the
 * block it was selected in decides: the comment's label starts with that block's first words. Returns why it can't when
 * the words aren't in the source as written (formatting inside them) or it can't tell which of them was meant.
 */
export function applySuggestion(
  body: string,
  quote: string,
  suggestion: string,
  label: string | null,
): { body: string } | { error: string } {
  const pattern = new RegExp(quote.trim().split(/\s+/).map(escape).join("\\s+"), "g")
  let matches = [...body.matchAll(pattern)]
  if (matches.length > 1) {
    const start = label?.match(/^[a-z0-9]+ "(.*?)…?"$/)?.[1]
    const blockAt = (index: number) => {
      const from = body.lastIndexOf("\n\n", index) + 1
      const to = body.indexOf("\n\n", index)
      return plain(body.slice(from, to < 0 ? undefined : to)).replace(/^(#{1,6}|>|[-+*]|\d+[.)])\s+/, "")
    }
    if (start) matches = matches.filter((match) => blockAt(match.index).startsWith(start))
    if (matches.length !== 1)
      return { error: "These words are in the doc more than once. Edit the doc to change the one you meant." }
  }
  const [match] = matches
  if (!match) return { error: "These words aren't in the Markdown as written. Edit the doc instead." }
  let before = body.slice(0, match.index)
  const after = body.slice(match.index + match[0].length)
  // A deleted word takes one of the spaces around it along, so "more than twelve pigeons" reads "more than pigeons".
  if (!suggestion && before.endsWith(" ") && /^[ \n.,;:!?)]/.test(after)) before = before.slice(0, -1)
  return { body: before + suggestion + after }
}
