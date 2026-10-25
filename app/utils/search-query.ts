import { DROP_KINDS, type DropKind } from "#shared/types"

// The ⌘K palette's search reads like GitHub's: plain words, plus `in:<folder>` and `kind:<kind>` qualifiers anywhere in
// it. A folder's name with spaces goes in quotes, `in:"Card Mailer"`. The filter chips under the palette write the same
// words, so what someone clicks is what they could have typed.

/** Words a kind answers to besides its own name. */
const KIND_WORDS = new Map<string, DropKind>([
  ["doc", "markdown"],
  ["docs", "markdown"],
  ["md", "markdown"],
  ["page", "html"],
  ["pages", "html"],
  ["images", "image"],
  ["img", "image"],
  ["files", "file"],
  ["apps", "app"],
  ["folders", "folder"],
  ["sites", "site"],
  ["boards", "board"],
])

const kindOf = (word: string) =>
  DROP_KINDS.find((kind) => kind === word.toLowerCase()) ?? KIND_WORDS.get(word.toLowerCase())

const QUALIFIER = /(?:^|\s)(in|kind):(?:"([^"]*)"?|(\S*))/gi

export interface SearchQuery {
  /** The words without the qualifiers. */
  words: string
  /** What `in:` names: a folder's title or id. */
  folder?: string
  kinds: DropKind[]
}

export function parseSearch(term: string): SearchQuery {
  let folder: string | undefined
  const kinds = new Set<DropKind>()
  const words = term.replace(QUALIFIER, (_, key: string, quoted?: string, bare?: string) => {
    const value = (quoted ?? bare ?? "").trim()
    if (key.toLowerCase() === "in") folder = value || folder
    else
      for (const word of value.split(",")) {
        const kind = kindOf(word)
        if (kind) kinds.add(kind)
      }
    return " "
  })
  return { words: words.replace(/\s+/g, " ").trim(), folder, kinds: [...kinds] }
}

/** `in:` for a folder, its title quoted when it has a space. */
export const inFolder = (title: string) => `in:${/[\s"]/.test(title) ? `"${title.replaceAll('"', "")}"` : title}`

/** The term with `kind:<kind>` added, or taken out with every other word that names that kind. */
export function toggleKind(term: string, kind: DropKind) {
  const on = parseSearch(term).kinds.includes(kind)
  if (!on) return `${term.trimEnd()} kind:${kind} `.trimStart()
  const rest = term.replace(/(^|\s)kind:(\S*)/gi, (_, space: string, value: string) => {
    const left = value.split(",").filter((word) => kindOf(word) !== kind)
    return left.length ? `${space}kind:${left.join(",")}` : space
  })
  return rest.replace(/\s+/g, " ").trimStart()
}

/** The term with its `in:` taken out, or put in for `title`. */
export function toggleFolder(term: string, title: string) {
  const rest = term
    .replace(/(^|\s)in:(?:"[^"]*"?|\S*)/gi, "$1")
    .replace(/\s+/g, " ")
    .trimStart()
  return parseSearch(term).folder ? rest : `${inFolder(title)} ${rest}`
}
