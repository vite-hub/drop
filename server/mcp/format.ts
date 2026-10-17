import { expiryLabel } from "#shared/expiry"
import type { DropComment, DropSummary } from "#shared/types"
import { dropPageUrl, type DropRow } from "../utils/drops"
import type { Share } from "../utils/drop-update"

/** What agents get back for a drop: enough to link it, embed its file, and know who can open it and for how long. */
export function mcpDrop(drop: DropSummary, origin: string, row?: Pick<DropRow, "blobKey">) {
  const share: Share = drop.visibility === "private" ? "private" : drop.access
  return {
    id: drop.id,
    title: drop.title,
    kind: drop.kind,
    version: drop.version,
    url: dropPageUrl(origin, drop),
    // Embed this in a doc (Markdown image, ::screenshot src) to make the file part of that doc.
    ...(row?.blobKey && (drop.kind === "image" || drop.kind === "file") ? { fileUrl: new URL(`/f/${row.blobKey}`, origin).href } : {}),
    share,
    ...(drop.visibility !== "private" ? { sharedWith: drop.visibility === "team" ? "team" as const : "link" as const } : {}),
    ...(drop.owner ? { owner: drop.owner.name } : {}),
    ...(drop.shareReview === "pending" ? { waitingForReview: true } : {}),
    lifetime: drop.lifetime,
    ...(drop.keepReason ? { keepReason: drop.keepReason } : {}),
    status: expiryLabel(drop, Date.now()),
    ...(drop.note ? { note: drop.note } : {}),
  }
}

export type McpDrop = ReturnType<typeof mcpDrop>

/** One line per drop for clients that only read text. */
export const dropLine = (drop: McpDrop) =>
  `- ${drop.title} (${drop.kind} v${drop.version}, ${drop.share}${drop.sharedWith ? ` with the ${drop.sharedWith}` : ""}${drop.owner ? `, by ${drop.owner}` : ""}${drop.waitingForReview ? " waiting for review" : ""}, ${drop.lifetime}, ${drop.status.toLowerCase()}) id=${drop.id} ${drop.url}${drop.fileUrl ? ` file=${drop.fileUrl}` : ""}`

/** Where a comment points, in words: the quoted text, or a spot or area as percentages of an image or element. */
export function commentTarget(comment: Pick<DropComment, "kind" | "quote" | "label" | "ox" | "oy" | "ow" | "oh">) {
  if (comment.kind === "text") return comment.quote ? `> ${comment.quote}` : comment.label ?? ""
  const pct = (n: number) => `${Math.round(n / 10)}%`
  const where = comment.ow || comment.oh
    ? `the area ${pct(comment.ox)}–${pct(comment.ox + comment.ow)} across, ${pct(comment.oy)}–${pct(comment.oy + comment.oh)} down`
    : `the spot ${pct(comment.ox)} across, ${pct(comment.oy)} down`
  return `[${where} of ${comment.label ?? (comment.kind === "image" ? "an image" : "an element")}]`
}

/** `version` is the one being read: a comment written on an earlier version says which. */
export const commentLine = (comment: DropComment, version: number) =>
  `${comment.n}. ${commentTarget(comment)}\n   ${comment.body} (${comment.authorName}${comment.page ? `, ${comment.page}` : ""}${comment.version < version ? `, on v${comment.version}` : ""})`
