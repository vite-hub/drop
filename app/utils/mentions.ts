// "@" in a comment names someone in this Drop. The box writes plain "@Name" text, the way the doc editor's people menu
// does, so a comment reads the same to agents, in copied feedback, and to readers who can't list the people.

export type Person = { id: string; name: string; image: string | null }

/** The "@…" being typed at the caret: where its "@" sits and the words after it. Names have spaces, so the query may too. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf("@")
  if (start < 0 || (start > 0 && !/[\s([{"'“]/u.test(before[start - 1]!))) return
  const query = before.slice(start + 1)
  if (query.length > 40 || /^\s|\n|\s{2}/u.test(query)) return
  return { start, query }
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase()

/** People whose name starts with the query, then those with a later word that does. */
export function matchPeople(people: Person[], query: string, limit = 6): Person[] {
  const q = fold(query)
  const first: Person[] = []
  const later: Person[] = []
  for (const person of people) {
    const name = fold(person.name)
    if (name.startsWith(q)) first.push(person)
    else if (name.split(/\s+/u).some((word, i) => i > 0 && word.startsWith(q))) later.push(person)
  }
  return [...first, ...later].slice(0, limit)
}

export type MentionPart = { text: string; mention?: string }

/** A comment's text cut into plain runs and "@Name" mentions of people in this Drop, longest name first. */
export function mentionParts(text: string, names: string[]): MentionPart[] {
  const known = [...new Set(names.filter(Boolean))].toSorted((a, b) => b.length - a.length)
  if (!known.length || !text.includes("@")) return [{ text }]
  const escaped = known.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  const pattern = new RegExp(`(^|[\\s([{"'“])@(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu")
  const parts: MentionPart[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index + match[1]!.length
    if (at > last) parts.push({ text: text.slice(last, at) })
    parts.push({ text: `@${match[2]}`, mention: match[2] })
    last = at + 1 + match[2]!.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
