/** A comment's suggested edit in words, for agents: what replaces the quote, or that it goes. Empty on a plain comment. */
export const suggestionLine = (suggestion: string | null | undefined, indent = "   ") =>
  suggestion == null
    ? ""
    : `\n${indent}${suggestion ? `Suggests replacing it with: ${suggestion.replace(/\n/g, `\n${indent}`)}` : "Suggests deleting it."}`
