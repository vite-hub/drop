import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { drops, dropTexts, dropVersions } from "../databases/default/index"
import { boardText, parseBoard } from "#shared/board"
import { splitFrontmatter } from "#shared/frontmatter"
import { DROP_KINDS } from "#shared/types"

export const MAX_SEARCH_TEXT = 64_000
export const SEARCH_KINDS = ["markdown", "html", "board"] as const

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
])

export function searchableText(kind: string, source: string) {
  let text = source
  if (kind === "board") {
    try {
      text = boardText(parseBoard(source))
    } catch {
      text = ""
    }
  } else if (kind === "html") {
    text = text
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|svg|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/i, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
        if (name[0] === "#") {
          const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " "
        }
        return ENTITIES.get(name.toLowerCase()) ?? entity
      })
  } else {
    text = splitFrontmatter(text)
      .body.replace(/^\s*#\s[^\n]*\n/, "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)]|`{3,}\w*|~{3,}\w*)\s?/gm, "")
      .replace(/[*_~`|]+/g, " ")
  }
  text = text.replace(/\s+/g, " ").trim()
  if (text.length <= MAX_SEARCH_TEXT) return text
  return text.slice(0, MAX_SEARCH_TEXT).replace(/[\uD800-\uDBFF]$/, "")
}

export const searchWords = (query?: string) =>
  query
    ?.toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^#(?=\d+$)/, ""))
    .filter(Boolean)
    .slice(0, 10) ?? []

export const searchKinds = (param?: string | null) => DROP_KINDS.filter((kind) => param?.split(",").includes(kind))

const encoder = new TextEncoder()

export function likePattern(...parts: string[]) {
  let escaped = ""
  for (const [index, part] of parts.entries()) {
    let gap = index ? "%" : ""
    for (const char of part) {
      const next = escaped + gap + char.replace(/[\\%_]/, "\\$&")
      if (encoder.encode(next).length > 48) return `%${escaped}%`
      escaped = next
      gap = ""
    }
  }
  return `%${escaped}%`
}

function namePattern(word: string) {
  const ref = word.match(/^([^#]+)#(\d+)$/)
  return ref ? likePattern(ref[1]!, ref[2]!) : likePattern(word)
}

const links = sql`(SELECT group_concat(coalesce(json_extract(value, '$.url'), '') || ' ' || coalesce(json_extract(value, '$.title'), ''), ' ') FROM json_each(CASE WHEN json_valid(${drops.resources}) THEN ${drops.resources} ELSE '[]' END))`

const named = sql`lower(${drops.title} || ' ' || ${drops.filename} || ' ' || coalesce(${drops.slug}, '') || ' ' || coalesce(${drops.note}, '') || ' ' || coalesce(${links}, ''))`

const inName = (word: string) => sql`${named} LIKE ${namePattern(word)} ESCAPE '\\'`

export const matching = (words: string[]) =>
  words.map(
    (word) =>
      sql`(${inName(word)} OR ${dropTexts.text} LIKE ${likePattern(word)} ESCAPE '\\' OR EXISTS (SELECT 1 FROM ${dropVersions} WHERE ${dropVersions.dropId} = ${drops.id} AND ${dropVersions.note} LIKE ${likePattern(word)} ESCAPE '\\'))`,
  )

const namedMatch = (words: string[]) =>
  words.length ? sql<number>`(CASE WHEN ${sql.join(words.map(inName), sql` AND `)} THEN 1 ELSE 0 END)` : sql<number>`0`

function snippetOf(words: string[]): SQL<string | null> {
  if (!words.length) return sql<null>`NULL`
  const at = sql.join(
    words.map((word) => sql`nullif(instr(lower(${dropTexts.text}), ${word}), 0)`),
    sql`, `,
  )
  const position = words.length > 1 ? sql`coalesce(${at})` : at
  return sql<string | null>`CASE WHEN ${dropTexts.text} IS NULL OR ${namedMatch(words)} = 1 THEN NULL
    ELSE (SELECT CASE WHEN p IS NULL THEN NULL ELSE (CASE WHEN p > 61 THEN '…' ELSE '' END) || substr(${dropTexts.text}, max(1, p - 60), 180) END FROM (SELECT ${position} AS p)) END`
}

function cleanSnippet(snippet: string | null) {
  if (!snippet) return undefined
  const lead = snippet.startsWith("…")
  let text = lead ? snippet.slice(1).replace(/^\S*\s/, "") : snippet
  const cut = text.length >= 179
  if (cut) text = text.replace(/\s\S*$/, "")
  return `${lead ? "…" : ""}${text.trim()}${cut ? "…" : ""}`
}

export async function searchDrops(where: SQL | undefined, words: string[], limit: number) {
  const rows = await db
    .select({ drop: drops, snippet: snippetOf(words), named: namedMatch(words).mapWith(Number).as("named_match") })
    .from(drops)
    .leftJoin(dropTexts, eq(dropTexts.dropId, drops.id))
    .where(and(where, ...matching(words)))
    .orderBy(sql`named_match DESC`, sql`${drops.updatedAt} DESC`)
    .limit(limit)
  return rows.map((row) => ({ drop: row.drop, snippet: cleanSnippet(row.snippet) }))
}

export function textStatements(row: { id: string; kind: string }, source: string | undefined) {
  const remove = db.delete(dropTexts).where(eq(dropTexts.dropId, row.id))
  if (source === undefined || !SEARCH_KINDS.some((kind) => kind === row.kind)) return [remove] as const
  return [remove, db.insert(dropTexts).values({ dropId: row.id, text: searchableText(row.kind, source) })] as const
}

export async function indexMissingTexts(limit = 100) {
  const missing = await db
    .select({ id: drops.id, kind: drops.kind, blobKey: drops.blobKey })
    .from(drops)
    .leftJoin(dropTexts, eq(dropTexts.dropId, drops.id))
    .where(and(isNull(dropTexts.dropId), inArray(drops.kind, [...SEARCH_KINDS]), isNotNull(drops.blobKey)))
    .limit(limit)
  let indexed = 0
  const failed: { drop: string; error: string }[] = []
  for (const doc of missing) {
    const [error, file] = await blob.get(doc.blobKey!)
    if (error && error.code !== "BLOB_NOT_FOUND") {
      failed.push({ drop: doc.id, error: error.message })
      continue
    }
    let source = ""
    try {
      source = file ? new TextDecoder("utf-8").decode(await file.arrayBuffer()) : ""
    } catch (failure) {
      failed.push({ drop: doc.id, error: failure instanceof Error ? failure.message : String(failure) })
      continue
    }
    await db
      .insert(dropTexts)
      .values({ dropId: doc.id, text: searchableText(doc.kind, source) })
      .onConflictDoNothing()
    indexed++
  }
  return { indexed, ...(failed.length ? { failed } : {}) }
}
