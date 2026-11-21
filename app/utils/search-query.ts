import { DROP_KINDS, type DropKind } from "#shared/types"

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
  ["links", "link"],
])

const kindOf = (word: string) =>
  DROP_KINDS.find((kind) => kind === word.toLowerCase()) ?? KIND_WORDS.get(word.toLowerCase())

const QUALIFIER = /(?:^|\s)(in|kind):(?:"([^"]*)"?|(\S*))/gi

export interface SearchQuery {
  words: string
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

export const inFolder = (title: string) => `in:${/[\s"]/.test(title) ? `"${title.replaceAll('"', "")}"` : title}`

export function toggleKind(term: string, kind: DropKind) {
  const on = parseSearch(term).kinds.includes(kind)
  if (!on) return `${term.trimEnd()} kind:${kind} `.trimStart()
  const rest = term.replace(/(^|\s)kind:(\S*)/gi, (_, space: string, value: string) => {
    const left = value.split(",").filter((word) => kindOf(word) !== kind)
    return left.length ? `${space}kind:${left.join(",")}` : space
  })
  return rest.replace(/\s+/g, " ").trimStart()
}

export function toggleFolder(term: string, title: string) {
  const rest = term
    .replace(/(^|\s)in:(?:"[^"]*"?|\S*)/gi, "$1")
    .replace(/\s+/g, " ")
    .trimStart()
  return parseSearch(term).folder ? rest : `${inFolder(title)} ${rest}`
}
