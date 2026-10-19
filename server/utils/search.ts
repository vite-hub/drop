import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { dropHeads, drops, dropTexts } from "../databases/config"
import { splitFrontmatter } from "#shared/frontmatter"

// Search matches a drop's title, file name and slug, and the words of a text doc, kept in `drop_texts` for latest
// versions. Plain LIKE scans, no FTS5: D1's export breaks on virtual tables, and a person's docs scan in milliseconds.

/** Text docs keep this many characters for search; the rest of a long doc isn't searchable. */
export const MAX_SEARCH_TEXT = 64_000
/** Kinds whose words are searchable. Plain text files are `markdown` drops. */
export const SEARCH_KINDS = ["markdown", "html"] as const

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
])

/**
 * What a reader sees of a doc, as one line of plain text: Markdown without its front matter and markup, HTML without
 * its tags, scripts and styles. Good enough to match words and show a snippet, not a renderer.
 */
export function searchableText(kind: string, source: string) {
  let text = source
  if (kind === "html") {
    // Like a Markdown doc's leading H1, the first <h1> is the title, which search matches on its own.
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
    // A leading H1 is the doc's title, which search matches on its own: snippets start with the words after it.
    text = splitFrontmatter(text)
      .body.replace(/^\s*#\s[^\n]*\n/, "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images keep their text
      .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)]|`{3,}\w*|~{3,}\w*)\s?/gm, "") // headings, quotes, list markers, fences
      .replace(/[*_~`|]+/g, " ")
  }
  text = text.replace(/\s+/g, " ").trim()
  if (text.length <= MAX_SEARCH_TEXT) return text
  // Never end on half a surrogate pair.
  return text.slice(0, MAX_SEARCH_TEXT).replace(/[\uD800-\uDBFF]$/, "")
}

/** Search words: lower case, at most ten, each matched anywhere in the title, file name, slug, or a doc's text. */
export const searchWords = (query?: string) => query?.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10) ?? []

const encoder = new TextEncoder()

/**
 * A word as a LIKE pattern. D1 refuses patterns over 50 bytes, so a long word keeps the escaped characters that fit in
 * 48 bytes; the two `%` take the rest. A prefix of the word still finds what the whole word would.
 */
export function likePattern(word: string) {
  let escaped = ""
  for (const char of word) {
    const next = escaped + char.replace(/[\\%_]/, "\\$&")
    if (encoder.encode(next).length > 48) break
    escaped = next
  }
  return `%${escaped}%`
}
const named = sql`lower(${drops.title} || ' ' || ${drops.filename} || ' ' || coalesce(${drops.slug}, ''))`

/**
 * One condition per word: the word is in the drop's name, or in its text. SQLite's LIKE ignores ASCII case already, so
 * the text isn't lowered row by row. Needs `drop_texts` left-joined (see `searchHeads`).
 */
export const matching = (words: string[]) =>
  words.map(
    (word) =>
      sql`(${named} LIKE ${likePattern(word)} ESCAPE '\\' OR ${dropTexts.text} LIKE ${likePattern(word)} ESCAPE '\\')`,
  )

/**
 * Words around the first word found in the doc's text, or null when the name alone matches every word. Worked out in
 * SQL, so a match never sends a whole doc back.
 */
function snippetOf(words: string[]): SQL<string | null> {
  if (!words.length) return sql<null>`NULL`
  const at = sql.join(
    words.map((word) => sql`nullif(instr(lower(${dropTexts.text}), ${word}), 0)`),
    sql`, `,
  )
  const position = words.length > 1 ? sql`coalesce(${at})` : at
  const nameOnly = sql.join(
    words.map((word) => sql`${named} LIKE ${likePattern(word)} ESCAPE '\\'`),
    sql` AND `,
  )
  return sql<string | null>`CASE WHEN ${dropTexts.text} IS NULL OR (${nameOnly}) THEN NULL
    ELSE (SELECT CASE WHEN p IS NULL THEN NULL ELSE (CASE WHEN p > 61 THEN '…' ELSE '' END) || substr(${dropTexts.text}, max(1, p - 60), 180) END FROM (SELECT ${position} AS p)) END`
}

/** Trims a snippet to whole words and marks where the text goes on. */
export function cleanSnippet(snippet: string | null) {
  if (!snippet) return undefined
  const lead = snippet.startsWith("…")
  let text = lead ? snippet.slice(1).replace(/^\S*\s/, "") : snippet
  const cut = text.length >= 179
  if (cut) text = text.replace(/\s\S*$/, "")
  return `${lead ? "…" : ""}${text.trim()}${cut ? "…" : ""}`
}

/**
 * Latest versions matching `words` (every word, in the name or the text), newest first, with a snippet when only the
 * text has them. `where` scopes the rows; it may use `drops` and `drop_heads`.
 */
export async function searchHeads(where: SQL | undefined, words: string[], limit: number) {
  const rows = await db
    .select({ drop: drops, snippet: snippetOf(words) })
    .from(dropHeads)
    .innerJoin(drops, eq(drops.id, dropHeads.dropId))
    .leftJoin(dropTexts, eq(dropTexts.dropId, drops.id))
    .where(and(where, ...matching(words)))
    .orderBy(sql`${dropHeads.updatedAt} DESC`)
    .limit(limit)
  return rows.map((row) => ({ drop: row.drop, snippet: cleanSnippet(row.snippet) }))
}

/**
 * The statements that keep a version's text: a row for the new version, and none for the one it replaces. Part of the
 * publish's batch, after the drop's own insert.
 */
export function textStatements(
  row: { id: string; kind: string },
  source: string | undefined,
  previousId?: string | null,
) {
  const statements = []
  if (previousId) statements.push(db.delete(dropTexts).where(eq(dropTexts.dropId, previousId)))
  if (source !== undefined && SEARCH_KINDS.some((kind) => kind === row.kind))
    statements.push(db.insert(dropTexts).values({ dropId: row.id, text: searchableText(row.kind, source) }))
  return statements
}

/**
 * Indexes latest text docs that have no text yet: the ones published before search read their words, or whose index
 * write failed. Run by the hourly schedule in small batches; a doc whose file is gone gets an empty text, so the batch
 * doesn't retry it forever. Returns how many it indexed.
 */
export async function indexMissingTexts(limit = 100) {
  const missing = await db
    .select({ id: drops.id, kind: drops.kind, blobKey: drops.blobKey })
    .from(dropHeads)
    .innerJoin(drops, eq(drops.id, dropHeads.dropId))
    .leftJoin(dropTexts, eq(dropTexts.dropId, drops.id))
    .where(and(isNull(dropTexts.dropId), inArray(drops.kind, [...SEARCH_KINDS]), isNotNull(drops.blobKey)))
    .limit(limit)
  let indexed = 0
  for (const doc of missing) {
    const [error, file] = await blob.get(doc.blobKey!)
    if (error && error.code !== "BLOB_NOT_FOUND") {
      log.error({ action: "search-index", drop: doc.id, error: error.message })
      continue
    }
    let source = ""
    try {
      source = file ? new TextDecoder("utf-8").decode(await file.arrayBuffer()) : ""
    } catch {}
    await db
      .insert(dropTexts)
      .values({ dropId: doc.id, text: searchableText(doc.kind, source) })
      .onConflictDoNothing()
    indexed++
  }
  return indexed
}
