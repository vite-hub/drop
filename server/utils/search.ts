import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { drops, dropTexts, dropVersions } from "../databases/default/index"
import { boardText, parseBoard } from "#shared/board"
import { splitFrontmatter } from "#shared/frontmatter"
import { DROP_KINDS } from "#shared/types"

// Search matches a drop's title, file name, slug, links and version notes, and the words of a text doc's latest version, kept in `drop_texts`. Plain LIKE scans, no FTS5: D1's export breaks on virtual tables, and a person's docs scan in milliseconds.

/** Text docs keep this many characters for search; the rest of a long doc isn't searchable. */
export const MAX_SEARCH_TEXT = 64_000
/** Kinds whose words are searchable. Plain text files are `markdown` drops. */
export const SEARCH_KINDS = ["markdown", "html", "board"] as const

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
  if (kind === "board") {
    // A board's source is its Excalidraw scene; its words are in the notes, texts, shapes and frame names.
    try {
      text = boardText(parseBoard(source))
    } catch {
      text = ""
    }
  } else if (kind === "html") {
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

/**
 * Search words: lower case, at most ten, each matched anywhere in a drop's name, links, version notes, or text. A
 * `#12` is the number alone, so it finds the PR link `…/pull/12` as well as a title's `app#12`.
 */
export const searchWords = (query?: string) =>
  query
    ?.toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^#(?=\d+$)/, ""))
    .filter(Boolean)
    .slice(0, 10) ?? []

/** `?kind=image,file`: the kinds a search keeps, the unknown ones left out. */
export const searchKinds = (param?: string | null) => DROP_KINDS.filter((kind) => param?.split(",").includes(kind))

const encoder = new TextEncoder()

/**
 * A word as a LIKE pattern. D1 refuses patterns over 50 bytes, so a long word keeps the escaped characters that fit in
 * 48 bytes; the two `%` take the rest. A prefix of the word still finds what the whole word would.
 */
export function likePattern(...parts: string[]) {
  // Parts after the first match anywhere after the one before.
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

/**
 * A word as a pattern for a drop's name and links. An `app#12` there also finds the link
 * `github.com/acme/app/pull/12`: anything may come between the repository and the number.
 */
function namePattern(word: string) {
  const ref = word.match(/^([^#]+)#(\d+)$/)
  return ref ? likePattern(ref[1]!, ref[2]!) : likePattern(word)
}

/**
 * A drop's links as plain words: each link's URL and title, decoded, never the JSON around them. Matching the raw
 * JSON would find `url` and `title` in every drop with links, and miss a title's `"quoted"` words behind their escapes.
 */
const links = sql`(SELECT group_concat(coalesce(json_extract(value, '$.url'), '') || ' ' || coalesce(json_extract(value, '$.title'), ''), ' ') FROM json_each(CASE WHEN json_valid(${drops.resources}) THEN ${drops.resources} ELSE '[]' END))`

/**
 * What a drop is called and points to, as one line: its title, file name, slug, latest version's note, and its links.
 * Words in a link's path match too: `account` and `settings` both match `/accountsettings`.
 */
const named = sql`lower(${drops.title} || ' ' || ${drops.filename} || ' ' || coalesce(${drops.slug}, '') || ' ' || coalesce(${drops.note}, '') || ' ' || coalesce(${links}, ''))`

const inName = (word: string) => sql`${named} LIKE ${namePattern(word)} ESCAPE '\\'`

/**
 * One condition per word: the word is in the drop's name or links, its text, or an earlier version's note. SQLite's
 * LIKE ignores ASCII case already, so the text isn't lowered row by row. Needs `drop_texts` left-joined (see
 * `searchDrops`).
 */
export const matching = (words: string[]) =>
  words.map(
    (word) =>
      sql`(${inName(word)} OR ${dropTexts.text} LIKE ${likePattern(word)} ESCAPE '\\' OR EXISTS (SELECT 1 FROM ${dropVersions} WHERE ${dropVersions.dropId} = ${drops.id} AND ${dropVersions.note} LIKE ${likePattern(word)} ESCAPE '\\'))`,
  )

/** 1 when every word is in the drop's name or links, which rank above matches in its text alone. */
const namedMatch = (words: string[]) =>
  words.length ? sql<number>`(CASE WHEN ${sql.join(words.map(inName), sql` AND `)} THEN 1 ELSE 0 END)` : sql<number>`0`

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
  return sql<string | null>`CASE WHEN ${dropTexts.text} IS NULL OR ${namedMatch(words)} = 1 THEN NULL
    ELSE (SELECT CASE WHEN p IS NULL THEN NULL ELSE (CASE WHEN p > 61 THEN '…' ELSE '' END) || substr(${dropTexts.text}, max(1, p - 60), 180) END FROM (SELECT ${position} AS p)) END`
}

/** Trims a snippet to whole words and marks where the text goes on. */
function cleanSnippet(snippet: string | null) {
  if (!snippet) return undefined
  const lead = snippet.startsWith("…")
  let text = lead ? snippet.slice(1).replace(/^\S*\s/, "") : snippet
  const cut = text.length >= 179
  if (cut) text = text.replace(/\s\S*$/, "")
  return `${lead ? "…" : ""}${text.trim()}${cut ? "…" : ""}`
}

/**
 * Drops matching `words` (every word, in the name, links, notes, or text): the ones whose name or links hold every
 * word first, then the rest, newest first in each, with a snippet when the name doesn't hold them. `where` scopes the
 * rows on `drops`.
 */
export async function searchDrops(where: SQL | undefined, words: string[], limit: number) {
  const rows = await db
    .select({ drop: drops, snippet: snippetOf(words), named: namedMatch(words).as("named_match") })
    .from(drops)
    .leftJoin(dropTexts, eq(dropTexts.dropId, drops.id))
    .where(and(where, ...matching(words)))
    .orderBy(sql`named_match DESC`, sql`${drops.updatedAt} DESC`)
    .limit(limit)
  return rows.map((row) => ({ drop: row.drop, snippet: cleanSnippet(row.snippet) }))
}

/**
 * The statements that keep a drop's text: the new version's replaces the one before. Part of the publish's batch,
 * after the drop's own write.
 */
export function textStatements(row: { id: string; kind: string }, source: string | undefined) {
  const remove = db.delete(dropTexts).where(eq(dropTexts.dropId, row.id))
  if (source === undefined || !SEARCH_KINDS.some((kind) => kind === row.kind)) return [remove] as const
  return [remove, db.insert(dropTexts).values({ dropId: row.id, text: searchableText(row.kind, source) })] as const
}

/**
 * Indexes latest text docs that have no text yet: the ones published before search read their words, or whose index
 * write failed. Run by the hourly schedule in small batches; a doc whose file is gone gets an empty text, so the batch
 * doesn't retry it forever. Returns how many it indexed.
 */
export async function indexMissingTexts(limit = 100) {
  const missing = await db
    .select({ id: drops.id, kind: drops.kind, blobKey: drops.blobKey })
    .from(drops)
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
