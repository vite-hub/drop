import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import { chunkParameters, db } from "vite-hub/database"
import type { DropPeek, DropPeeks } from "#shared/types"
import { dropTexts, drops } from "../../databases/default/index"
import { ancestorsOf } from "../nodes"
import { SEARCH_KINDS } from "../search"

export const PEEK_TEXT = 360
export const PEEK_INSIDE = 3
const MAX_PEEKS = 90

const CALLOUT = /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi
const hasText = (kind: string) => SEARCH_KINDS.some((searched) => searched === kind)

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
  const folders = rows.flatMap((row) => (row.kind === "folder" ? [row.id] : []))
  const inside = folders.length ? await newestInside(ownerId, folders) : []
  const texted = [...rows, ...inside].flatMap((row) => (hasText(row.kind) ? [row.id] : []))
  const texts = new Map<string, string>()
  for (const chunk of chunkParameters(texted, { reserved: 10 }))
    for (const row of await db
      .select({ id: dropTexts.dropId, text: sql<string>`substr(${dropTexts.text}, 1, ${PEEK_TEXT})` })
      .from(dropTexts)
      .where(inArray(dropTexts.dropId, chunk)))
      if (row.text) texts.set(row.id, row.text.replace(CALLOUT, " ").replace(/\s+/g, " ").trim())
  const peek = (row: { id: string; kind: DropPeek["kind"]; title: string; blobKey: string | null }): DropPeek => ({
    id: row.id,
    kind: row.kind,
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
