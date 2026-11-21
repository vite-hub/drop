import { escapeRegExp } from "./utils/text"

export const suggestionLine = (suggestion: string | null | undefined, indent = "   ") =>
  suggestion == null
    ? ""
    : `\n${indent}${suggestion ? `Suggests replacing it with: ${suggestion.replace(/\n/g, `\n${indent}`)}` : "Suggests deleting it."}`

const plain = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()

export function applySuggestion(
  body: string,
  quote: string,
  suggestion: string,
  label: string | null,
): { body: string } | { error: string } {
  const pattern = new RegExp(quote.trim().split(/\s+/).map(escapeRegExp).join("\\s+"), "g")
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
  if (!suggestion && before.endsWith(" ") && /^[ \n.,;:!?)]/.test(after)) before = before.slice(0, -1)
  return { body: before + suggestion + after }
}
