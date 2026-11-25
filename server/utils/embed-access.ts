import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import { isPublic } from "#shared/share"
import type { PrivateEmbed, UncheckedEmbeds } from "#shared/types"
import { drops } from "../databases/default/index"
import { type DropRow, findDrop, findDrops, permissions, readText } from "./drops"
import { expiryPolicy } from "./expiry"
import type { Identity } from "./identity"
import { logError } from "./logs"
import { foldersUnder, resolveNode } from "./nodes"

const MAX_DOCS = 50
const MAX_LINKS = 20

export interface EmbedCheck {
  embeds: PrivateEmbed[]
  unchecked: UncheckedEmbeds | null
  failed?: boolean
}

type Node = NonNullable<DropRow["raw"]>
type Approval = (row: DropRow) => DropRow

const pathOf = (row: DropRow): Node[] => [row.raw ?? row, ...(row.ancestors ?? [])]

const approving =
  (account: string, days: number): Approval =>
  (row) => {
    if (!row.shareReview) return row
    if (row.ownerId === account) return { ...row, shareReview: null }
    const clear = (node: Node) =>
      node.ownerId === account && isPublic(node.share) ? { ...node, shareReview: null } : node
    const [own, ...above] = pathOf(row).map(clear)
    return { ...row, ...resolveNode(own!, above, days) }
  }

const asItStands: Approval = (row) => row
const readable = (row: DropRow) => permissions(row, null).view

function approvalsOpening(doc: DropRow, days: number): Approval[] {
  if (readable(doc)) return [asItStands]
  if (!doc.shareReview) return []
  const held = [...new Set(pathOf(doc).flatMap((node) => (node.shareReview ? [node.ownerId] : [])))]
  const opening = held.map((account) => approving(account, days)).filter((approval) => readable(approval(doc)))
  if (opening.length) return opening
  return readable({ ...doc, shareReview: null }) ? [asItStands] : []
}

async function scan(docs: DropRow[], who: Identity, event?: H3Event, skippedDocs = 0): Promise<EmbedCheck> {
  const { embeddedLinks, renderMarkdownCached } = await import("./markdown-document")
  const { days } = expiryPolicy(event)
  let skippedLinks = 0
  const read: { doc: DropRow; approvals: Approval[]; links: string[] }[] = []
  for (const doc of docs.slice(0, MAX_DOCS)) {
    const key = doc.blobKey
    const approvals = doc.kind === "markdown" && key ? approvalsOpening(doc, days) : []
    if (!key || !approvals.length) continue
    const { html } = await renderMarkdownCached(key, () => readText(key), event)
    const all = embeddedLinks(html).filter((link) => link !== doc.id)
    skippedLinks += Math.max(0, all.length - MAX_LINKS)
    read.push({ doc, approvals, links: all.slice(0, MAX_LINKS) })
  }
  const targets = await findDrops([...new Set(read.flatMap(({ links }) => links))], event)
  const found: PrivateEmbed[] = []
  for (const { doc, approvals, links } of read)
    for (const link of links) {
      const target = targets.get(link)
      const named = { id: doc.id, title: doc.title }
      if (target && approvals.every((approval) => readable(approval(target)))) continue
      found.push({ doc: named, link, title: target && permissions(target, who).view ? target.title : null })
    }
  const docsLeft = skippedDocs + Math.max(0, docs.length - MAX_DOCS)
  return { embeds: found, unchecked: docsLeft || skippedLinks ? { docs: docsLeft, embeds: skippedLinks } : null }
}

async function advisory(run: () => Promise<EmbedCheck>, event?: H3Event, id?: string): Promise<EmbedCheck> {
  try {
    return await run()
  } catch (error) {
    logError(event, error, { action: "embed-check", drop: id })
    return { embeds: [], unchecked: null, failed: true }
  }
}

export const privateEmbeds = (docs: DropRow[], who: Identity, event?: H3Event) =>
  advisory(() => scan(docs, who, event), event, docs[0]?.id)

export const openedEmbeds = (id: string, who: Identity, event?: H3Event) =>
  advisory(
    async () => {
      const drop = await findDrop(id, event)
      if (!drop || !approvalsOpening(drop, expiryPolicy(event).days).length) return { embeds: [], unchecked: null }
      const { docs, skipped } = await docsUnder(drop, event)
      return scan(docs, who, event, skipped)
    },
    event,
    id,
  )

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
  const found = await findDrops(
    rows.map(({ id }) => id),
    event,
  )
  return {
    docs: rows.flatMap(({ id }) => found.get(id) ?? []),
    skipped: Math.max(0, (total?.count ?? 0) - rows.length),
  }
}

export const embedResponse = ({ embeds, unchecked, failed }: EmbedCheck) => ({
  ...(embeds.length ? { privateEmbeds: embeds } : {}),
  ...(unchecked ? { uncheckedEmbeds: unchecked } : {}),
  ...(failed ? { embedCheckFailed: true } : {}),
})

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

const embedWarning = ({ doc, link, title }: PrivateEmbed) =>
  title === null
    ? `drop/embed-private "${doc.title}" embeds /d/${link}, a drop you can't open, so people with the public link can't open it either. Remove the embed, or ask its owner to share it the same way as the doc.`
    : `drop/embed-private "${doc.title}" embeds "${title}" (/d/${link}), which people with the public link can't open. Share it the same way as the doc, or remove the embed.`

const partialWarning = ({ docs, embeds }: UncheckedEmbeds) => {
  const parts = [
    ...(docs ? [`${plural(docs, "doc")} past the ${MAX_DOCS} most recently updated`] : []),
    ...(embeds ? [`${plural(embeds, "embed")} past the first ${MAX_LINKS} in a doc`] : []),
  ]
  return `drop/embed-partial The check was partial: it didn't read ${parts.join(" or ")}. Open those docs to check their embeds.`
}

const FAILED_WARNING =
  "drop/embed-unchecked The change is saved, but the check for embeds people with the public link can't open didn't complete. Open the doc to check its embeds."

export const embedWarnings = ({ embeds, unchecked, failed }: EmbedCheck) => [
  ...embeds.map(embedWarning),
  ...(unchecked ? [partialWarning(unchecked)] : []),
  ...(failed ? [FAILED_WARNING] : []),
]

const EMBED_WARNINGS_LEAD =
  'People with the public link can\'t open these embedded drops: they see "This drop is private, expired, or deleted" in their place.'

const UNCHECKED_EMBEDS_LEAD = "Drop couldn't check every embed for people with the public link:"

export const embedSection = (warnings: string[]) =>
  warnings.length
    ? `\n\n${warnings.some((warning) => warning.startsWith("drop/embed-private")) ? EMBED_WARNINGS_LEAD : UNCHECKED_EMBEDS_LEAD}\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
