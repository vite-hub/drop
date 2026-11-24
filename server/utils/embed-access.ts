import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import type { PrivateEmbed, UncheckedEmbeds } from "#shared/types"
import { drops } from "../databases/default/index"
import { type DropRow, findDrop, permissions, readText } from "./drops"
import type { Identity } from "./identity"
import { foldersUnder } from "./nodes"

const MAX_DOCS = 50
const MAX_LINKS = 20

export interface EmbedCheck {
  embeds: PrivateEmbed[]
  unchecked: UncheckedEmbeds | null
}

const approved = (row: DropRow): DropRow => (row.shareReview === "pending" ? { ...row, shareReview: null } : row)

const asSeenFrom = (doc: DropRow, target: DropRow) =>
  doc.shareReview === "pending" && target.ownerId === doc.ownerId ? approved(target) : target

export async function privateEmbeds(docs: DropRow[], who: Identity, event?: H3Event, skippedDocs = 0) {
  const { embeddedLinks, renderMarkdownCached } = await import("./markdown-document")
  const found: PrivateEmbed[] = []
  let skippedLinks = 0
  for (const row of docs.slice(0, MAX_DOCS)) {
    const key = row.blobKey
    if (row.kind !== "markdown" || !key || !permissions(approved(row), null).view) continue
    const { html } = await renderMarkdownCached(key, () => readText(key), event)
    const all = embeddedLinks(html).filter((link) => link !== row.id)
    skippedLinks += Math.max(0, all.length - MAX_LINKS)
    const links = all.slice(0, MAX_LINKS)
    const targets = await Promise.all(links.map((link) => findDrop(link, event)))
    const doc = { id: row.id, title: row.title }
    links.forEach((link, index) => {
      const target = targets[index]
      if (!target) found.push({ doc, link, title: null, missing: true })
      else if (!permissions(asSeenFrom(row, target), null).view)
        found.push({ doc, link, title: permissions(target, who).view ? target.title : null })
    })
  }
  const docsLeft = skippedDocs + Math.max(0, docs.length - MAX_DOCS)
  const unchecked = docsLeft || skippedLinks ? { docs: docsLeft, embeds: skippedLinks } : null
  return { embeds: found, unchecked } satisfies EmbedCheck
}

export async function openedEmbeds(id: string, who: Identity, event?: H3Event): Promise<EmbedCheck> {
  const drop = await findDrop(id, event)
  if (!drop || !permissions(approved(drop), null).view) return { embeds: [], unchecked: null }
  const { docs, skipped } = await docsUnder(drop, event)
  return privateEmbeds(docs, who, event, skipped)
}

async function docsUnder(drop: DropRow, event?: H3Event): Promise<{ docs: DropRow[]; skipped: number }> {
  if (drop.kind === "markdown") return { docs: [drop], skipped: 0 }
  if (drop.kind !== "folder") return { docs: [], skipped: 0 }
  const inside = and(
    inArray(drops.parentId, foldersUnder(drop.id)),
    eq(drops.kind, "markdown"),
    isNull(drops.trashedAt),
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({ id: drops.id })
      .from(drops)
      .where(inside)
      .orderBy(desc(drops.updatedAt), desc(drops.id))
      .limit(MAX_DOCS),
    db.select({ count: count() }).from(drops).where(inside),
  ])
  const found = await Promise.all(rows.map(({ id }) => findDrop(id, event)))
  return { docs: found.filter((row) => row !== null), skipped: Math.max(0, (total?.count ?? 0) - rows.length) }
}

export const embedResponse = ({ embeds, unchecked }: EmbedCheck) => ({
  ...(embeds.length ? { privateEmbeds: embeds } : {}),
  ...(unchecked ? { uncheckedEmbeds: unchecked } : {}),
})

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

const embedWarning = ({ doc, link, title, missing }: PrivateEmbed) =>
  missing
    ? `drop/embed-missing "${doc.title}" embeds /d/${link}, a drop that no longer exists; readers see a note in its place. Remove the embed or point it at another drop.`
    : `drop/embed-private "${doc.title}" embeds ${title === null ? "a drop" : `"${title}"`} (/d/${link}), which people with the public link can't open. Share it the same way as the doc, or remove the embed.`

const partialWarning = ({ docs, embeds }: UncheckedEmbeds) => {
  const parts = [
    ...(docs ? [`${plural(docs, "doc")} past the ${MAX_DOCS} most recently updated`] : []),
    ...(embeds ? [`${plural(embeds, "embed")} past the first ${MAX_LINKS} in a doc`] : []),
  ]
  return `drop/embed-partial The check was partial: it didn't read ${parts.join(" or ")}. Open those docs to check their embeds.`
}

export const embedWarnings = ({ embeds, unchecked }: EmbedCheck) => [
  ...embeds.map(embedWarning),
  ...(unchecked ? [partialWarning(unchecked)] : []),
]

const EMBED_WARNINGS_LEAD =
  'People with the public link can\'t open these embedded drops: they see "This drop is private, expired, or deleted", or a note that it no longer exists, in their place.'

export const embedSection = (warnings: string[]) =>
  warnings.length ? `\n\n${EMBED_WARNINGS_LEAD}\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : ""
