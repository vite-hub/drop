import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import type { DropPeek, DropPeeks } from "#shared/types"
import { dropTexts, drops } from "../../databases/config"
import { ancestorsOf } from "../nodes"
import { SEARCH_KINDS } from "../search"

/** About a card's worth of a doc: the Drops page shows its first lines, not the whole text. */
export const PEEK_TEXT = 360
/** How many of a folder's drops its card fans out. */
export const PEEK_INSIDE = 3
/** At most this many drops per request: D1 binds at most 100 parameters per query. */
const MAX_PEEKS = 90

// Search text keeps a callout's marker (`[!NOTE]`), which a preview reads as noise.
const CALLOUT = /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi
const hasText = (kind: string) => SEARCH_KINDS.some((searched) => searched === kind)

/**
 * What the Drops page's cards preview, for `ids` the owner has: a text doc's or board's first words (its search text,
 * so no file is read), an image's file, and a folder's newest PEEK_INSIDE drops with theirs. Nothing here touches a
 * drop's views or its expiry, which only opening it does.
 */
export async function peeksOf(ownerId: string, ids: string[]): Promise<DropPeeks> {
  const wanted = [...new Set(ids)].slice(0, MAX_PEEKS)
  if (!wanted.length) return {}
  const requested = await db
    .select({
      id: drops.id,
      parentId: drops.parentId,
      ownerId: drops.ownerId,
      teamFolder: drops.teamFolder,
      kind: drops.kind,
      title: drops.title,
      blobKey: drops.blobKey,
    })
    .from(drops)
    .where(and(eq(drops.ownerId, ownerId), inArray(drops.id, wanted), isNull(drops.quarantinedAt)))
  const ancestors = await ancestorsOf(requested)
  const rows = requested.filter((row) => !ancestors.get(row.id)?.some((parent) => parent.quarantinedAt))
  const folders = rows.filter((row) => row.kind === "folder").map((row) => row.id)
  const inside = folders.length ? await newestInside(ownerId, folders) : []
  const texted = [...rows, ...inside].filter((row) => hasText(row.kind)).map((row) => row.id)
  const texts = new Map<string, string>()
  for (let offset = 0; offset < texted.length; offset += MAX_PEEKS)
    for (const row of await db
      .select({ id: dropTexts.dropId, text: sql<string>`substr(${dropTexts.text}, 1, ${PEEK_TEXT})` })
      .from(dropTexts)
      .where(inArray(dropTexts.dropId, texted.slice(offset, offset + MAX_PEEKS))))
      if (row.text) texts.set(row.id, row.text.replace(CALLOUT, " ").replace(/\s+/g, " ").trim())
  const peek = (row: { id: string; kind: string; title: string; blobKey: string | null }): DropPeek => ({
    id: row.id,
    kind: row.kind as DropPeek["kind"],
    title: row.title,
    ...(row.kind === "image" && row.blobKey ? { thumbnail: `/f/${row.blobKey}` } : {}),
    ...(texts.has(row.id) ? { text: texts.get(row.id) } : {}),
  })
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        ...peek(row),
        ...(row.kind === "folder" ? { inside: inside.filter((child) => child.parentId === row.id).map(peek) } : {}),
      },
    ]),
  )
}

/** Each visible folder's newest owned, non-quarantined drops, ranked in the query so a folder of hundreds sends three. */
function newestInside(ownerId: string, folders: string[]) {
  const ranked = db
    .select({
      id: drops.id,
      parentId: drops.parentId,
      kind: drops.kind,
      title: drops.title,
      blobKey: drops.blobKey,
      rank: sql<number>`row_number() over (partition by ${drops.parentId} order by ${drops.updatedAt} desc)`.as("rank"),
    })
    .from(drops)
    // Their ancestors are the visible folder's path, already checked above.
    .where(
      and(
        eq(drops.ownerId, ownerId),
        inArray(drops.parentId, folders),
        isNull(drops.trashedAt),
        isNull(drops.quarantinedAt),
      ),
    )
    .as("ranked")
  return db
    .select()
    .from(ranked)
    .where(lte(ranked.rank, PEEK_INSIDE))
    .orderBy(ranked.parentId, sql`${ranked.rank}`)
}
