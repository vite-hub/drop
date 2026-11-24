import { and, eq, inArray, isNull } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import type { PrivateEmbed } from "#shared/types"
import { drops } from "../databases/default/index"
import { type DropRow, findDrop, permissions, readText } from "./drops"
import type { Identity } from "./identity"
import { foldersUnder } from "./nodes"

const MAX_DOCS = 50
const MAX_LINKS = 20

const approved = (row: DropRow): DropRow => (row.shareReview === "pending" ? { ...row, shareReview: null } : row)

export async function privateEmbeds(docs: DropRow[], who: Identity, event?: H3Event): Promise<PrivateEmbed[]> {
  const { embeddedLinks, renderMarkdownCached } = await import("./markdown-document")
  const found: PrivateEmbed[] = []
  for (const row of docs.slice(0, MAX_DOCS)) {
    const key = row.blobKey
    if (row.kind !== "markdown" || !key || !permissions(approved(row), null).view) continue
    const { html } = await renderMarkdownCached(key, () => readText(key), event)
    const links = embeddedLinks(html)
      .filter((link) => link !== row.id)
      .slice(0, MAX_LINKS)
    const targets = await Promise.all(links.map((link) => findDrop(link, event)))
    links.forEach((link, index) => {
      const target = targets[index]
      if (!target) return
      const seen = target.ownerId === row.ownerId ? approved(target) : target
      if (permissions(seen, null).view) return
      found.push({
        doc: { id: row.id, title: row.title },
        link,
        title: permissions(target, who).view ? target.title : null,
      })
    })
  }
  return found
}

export async function openedEmbeds(id: string, who: Identity, event?: H3Event) {
  const drop = await findDrop(id, event)
  if (!drop || !permissions(approved(drop), null).view) return []
  return privateEmbeds(await docsUnder(drop, event), who, event)
}

async function docsUnder(drop: DropRow, event?: H3Event): Promise<DropRow[]> {
  if (drop.kind === "markdown") return [drop]
  if (drop.kind !== "folder") return []
  const rows = await db
    .select({ id: drops.id })
    .from(drops)
    .where(and(inArray(drops.parentId, foldersUnder(drop.id)), eq(drops.kind, "markdown"), isNull(drops.trashedAt)))
    .limit(MAX_DOCS)
  const found = await Promise.all(rows.map(({ id }) => findDrop(id, event)))
  return found.filter((row) => row !== null)
}

export const embedWarning = ({ doc, link, title }: PrivateEmbed) =>
  `drop/embed-private "${doc.title}" embeds ${title === null ? "a drop" : `"${title}"`} (/d/${link}), which people with the public link can't open. Share it the same way as the doc, or remove the embed.`

const EMBED_WARNINGS_LEAD =
  'People with the public link can\'t open these embedded drops: they see "This drop is private, expired, or deleted" in their place.'

export const embedSection = (warnings: string[]) =>
  warnings.length ? `\n\n${EMBED_WARNINGS_LEAD}\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : ""
