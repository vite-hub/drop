import { expiryLabel } from "#shared/expiry"
import type { DropComment, DropResource, DropSummary, ViewerKind } from "#shared/types"
import { dropPageUrl, type DropRow } from "../utils/drops"

/** How every tool describes the share input: one state, the same names the pages use. */
export const SHARE_INPUT =
  "Who can open it: private (only the user), team (everyone on the team opens and comments: everyone signed in to a team Drop, or a team's members in its folders), team_edit (the team also edits a Markdown doc, or the Markdown in a folder, together in the browser), public (anyone with the link opens it, signed-in people comment), or public_comment (anyone with the link comments too, guests included). On a team Drop a public link closes after a few days and it's back to team. Leave it out to keep the current share; a new drop starts as this Drop's default: team on a team Drop or in a team's folders, private otherwise, and inside a folder it shares at least as wide as the folder. Make it public only when the user asks or it's clearly meant for people outside, such as a pull request asset."

/** What agents get back for a drop: enough to link it, embed its file, and know who can open it and for how long. */
export function mcpDrop(drop: DropSummary, origin: string, row?: Pick<DropRow, "blobKey">) {
  const file = row?.blobKey ? `/f/${row.blobKey}` : drop.thumbnail
  return {
    id: drop.id,
    title: drop.title,
    kind: drop.kind,
    version: drop.version,
    url: dropPageUrl(origin, drop),
    // Embed this in a doc (Markdown image, ::screenshot src) to make the file part of that doc.
    ...(file && (drop.kind === "image" || drop.kind === "file") ? { fileUrl: new URL(file, origin).href } : {}),
    // Search results say where a drop sits.
    ...(drop.path?.length ? { folder: drop.path.map((crumb) => crumb.title).join(" / ") } : {}),
    // A doc found by its text: the words around the match.
    ...(drop.snippet ? { match: drop.snippet } : {}),
    ...(drop.items !== undefined ? { items: drop.items } : {}),
    share: drop.share,
    ...(drop.publicUntil ? { publicUntil: new Date(drop.publicUntil).toISOString() } : {}),
    ...(drop.teamFolder ? { teamFolder: true } : {}),
    // The share comes from a folder above, wider than the drop's own.
    ...(drop.sharedFrom ? { sharedThrough: drop.sharedFrom.title } : {}),
    ...(drop.owner ? { owner: drop.owner.name } : {}),
    ...(drop.shareReview === "pending" ? { waitingForReview: true } : {}),
    lifetime: drop.lifetime,
    ...(drop.keepReason ? { keepReason: drop.keepReason } : {}),
    status: expiryLabel(drop, Date.now()),
    // A folder's note is its description: what goes in it and how.
    ...(drop.note ? (drop.kind === "folder" ? { description: drop.note } : { note: drop.note }) : {}),
  }
}

export type McpDrop = ReturnType<typeof mcpDrop>

/** A drop's views for its owner's agents, split the way Details shows them. */
export const mcpViews = (views: Record<ViewerKind, number>) => ({
  total: views.person + views.anonymous + views.agent,
  signedIn: views.person,
  anonymous: views.anonymous,
  agents: views.agent,
})

/** A drop's links, for agents that read text: one per line, so they can pass them back to update_drop. */
export const resourcesLines = (resources: DropResource[]) =>
  `Links:\n${resources.map((resource) => `- ${resource.title ? `${resource.title}: ` : ""}${resource.url}`).join("\n")}`

export const viewsLine = (views: ReturnType<typeof mcpViews>) =>
  `Views: ${views.total} (${views.signedIn} signed in, ${views.anonymous} anonymous, ${views.agents} by agents), each viewer counted once a day`

/** One line per drop for clients that only read text. */
export const dropLine = (drop: McpDrop) =>
  `- ${drop.title} (${drop.kind === "folder" ? `folder, ${drop.items ?? 0} ${drop.items === 1 ? "item" : "items"}` : `${drop.kind} v${drop.version}`}${drop.teamFolder ? ", the team's" : ""}${drop.folder ? ` in ${drop.folder}` : ""}, ${drop.share}${drop.publicUntil ? ` until ${drop.publicUntil.slice(0, 10)}` : ""}${drop.sharedThrough ? ` through ${drop.sharedThrough}` : ""}${drop.owner ? `, by ${drop.owner}` : ""}${drop.waitingForReview ? " waiting for review" : ""}, ${drop.lifetime}, ${drop.status.toLowerCase()}) id=${drop.id} ${drop.url}${drop.fileUrl ? ` file=${drop.fileUrl}` : ""}`

const pct = (n: number) => `${Math.round(n / 10)}%`

/**
 * Where a comment points, in words: the quoted text, a spot or area as percentages of an image or element, or the whole
 * page. An anchor's path starts at its nearest element with an id, which names the section it sits in (`in #v-prism`).
 */
export function commentTarget(
  comment: Pick<DropComment, "kind" | "selector" | "quote" | "label" | "ox" | "oy" | "ow" | "oh">,
) {
  if (comment.kind === "page") return "[the whole page]"
  const section = comment.selector?.match(/^#([a-z][\w-]*)/i)?.[1]
  const within = section ? ` (in #${section})` : ""
  if (comment.kind === "text") return `${comment.quote ? `> ${comment.quote}` : (comment.label ?? "")}${within}`
  const where =
    comment.ow || comment.oh
      ? `the area ${pct(comment.ox)}–${pct(comment.ox + comment.ow)} across, ${pct(comment.oy)}–${pct(comment.oy + comment.oh)} down`
      : `the spot ${pct(comment.ox)} across, ${pct(comment.oy)} down`
  return `[${where} of ${comment.label ?? (comment.kind === "image" ? "an image" : "an element")}]${within}`
}

/** `version` is the one being read: a comment written on an earlier version says which. */
export const commentLine = (comment: DropComment, version: number, origin: string) =>
  `${comment.n}. ${commentTarget(comment)}\n   ${comment.body} (${comment.authorName}${comment.page ? `, ${comment.page}` : ""}${comment.version < version ? `, on v${comment.version}` : ""})${imageLine(comment, origin)}${replyLines(comment, origin)}`

/** The images sent with a comment or a reply, as full addresses an agent can fetch. */
export const imageUrls = (item: Pick<DropComment, "attachments">, origin: string) =>
  item.attachments.map((file) => new URL(file.url, origin).href)

const imageLine = (item: Pick<DropComment, "attachments">, origin: string, indent = "   ") =>
  item.attachments.length ? `\n${indent}Images: ${imageUrls(item, origin).join(" ")}` : ""

/** A comment's thread under it, oldest first, one line per reply. */
export const replyLines = (comment: Pick<DropComment, "replies">, origin: string) =>
  comment.replies
    .map((reply) => `\n   ↳ ${reply.authorName}: ${reply.body}${imageLine(reply, origin, "     ")}`)
    .join("")

/** The thread for structured output. */
export const replyItems = (comment: Pick<DropComment, "replies">, origin: string) =>
  comment.replies.map((reply) => ({
    body: reply.body,
    author: reply.authorName,
    at: new Date(reply.createdAt).toISOString(),
    images: imageUrls(reply, origin),
  }))
