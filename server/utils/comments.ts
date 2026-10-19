import { and, asc, eq, inArray, lte, type SQL, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { commentReplies, comments, drops, user } from "../databases/config"
import type { CommentReply, DropComment } from "#shared/types"
import type { DropRow } from "./drops"
import { chainOf } from "./expiry"
import type { Identity } from "./identity"

export type CommentRow = typeof comments.$inferSelect

export type ReplyRow = typeof commentReplies.$inferSelect
/** What toComment adds from other tables: the authors' pictures by user id, and each comment's replies. */
export type CommentExtras = { images: Map<string, string | null>; replies: Map<string, ReplyRow[]> }

const toReply = (row: ReplyRow, who: Identity | null, images?: Map<string, string | null>): CommentReply => ({
  id: row.id,
  body: row.body,
  authorName: row.authorName,
  authorImage: (row.authorId && images?.get(row.authorId)) || null,
  createdAt: row.createdAt,
  mine: Boolean(who && row.authorId === who.userId),
})

export const toComment = (
  row: CommentRow,
  who: Identity | null,
  version: number,
  extras?: CommentExtras,
): DropComment => ({
  id: row.id,
  n: row.n,
  kind: row.kind,
  selector: row.selector,
  ox: row.ox,
  oy: row.oy,
  ow: row.ow,
  oh: row.oh,
  quote: row.quote,
  label: row.label,
  page: row.page,
  body: row.body,
  authorName: row.authorName,
  authorImage: (row.authorId && extras?.images.get(row.authorId)) || null,
  resolved: row.resolved,
  createdAt: row.createdAt,
  version,
  mine: Boolean(who && row.authorId === who.userId),
  replies: (extras?.replies.get(row.id) ?? []).map((reply) => toReply(reply, who, extras?.images)),
})

/** The pictures of the people who wrote `rows`. Guests and agents without one get initials. D1 binds at most 100. */
export async function authorImages(rows: Pick<CommentRow, "authorId">[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.authorId ? [row.authorId] : [])))]
  const images = new Map<string, string | null>()
  for (let index = 0; index < ids.length; index += 90) {
    const people = await db
      .select({ id: user.id, image: user.image })
      .from(user)
      .where(inArray(user.id, ids.slice(index, index + 90)))
    for (const person of people) images.set(person.id, person.image)
  }
  return images
}

/**
 * The replies and pictures for comments on the drops `dropIds` selects (a subquery, so no list of ids to bind).
 * Replies come oldest first, grouped by comment.
 */
export async function commentExtras(rows: CommentRow[], dropIds: SQL) {
  const replies = rows.length
    ? await db
        .select()
        .from(commentReplies)
        .where(sql`${commentReplies.commentId} IN (SELECT id FROM comments WHERE drop_id IN (${dropIds}))`)
        .orderBy(asc(commentReplies.createdAt))
    : []
  const byComment = new Map<string, ReplyRow[]>()
  for (const reply of replies) byComment.set(reply.commentId, [...(byComment.get(reply.commentId) ?? []), reply])
  return { images: await authorImages([...rows, ...replies]), replies: byComment }
}

/**
 * A site and the screenshots sent from it. Their comments make one list, numbered together, so "#4" names one
 * comment on the whole site. Empty unless `siteId` is a site.
 */
export const siteFamily = (siteId: string | null) =>
  sql`SELECT id FROM drops WHERE id = ${siteId} AND kind = 'site' UNION SELECT c.id FROM drops c JOIN drops s ON s.id = c.parent_id WHERE s.id = ${siteId} AND s.kind = 'site'`

/** The site whose review list a drop's comments belong to: the site itself, or the site a screenshot came from. */
const siteOf = (row: Pick<DropRow, "id" | "kind" | "parentId">) => (row.kind === "site" ? row.id : row.parentId)

/**
 * A version's comments and those of every version before it: a comment stays with the doc until someone resolves it.
 * The viewer decides which of the older ones still fit the page (see `outdated` in DropViewer.vue). Apps have no
 * versions, so theirs are always their own. A site has no versions either; its list takes in its screenshots'.
 */
export async function listComments(row: Pick<DropRow, "id" | "ownerId" | "version" | "kind">, who: Identity | null) {
  if (row.kind === "site") {
    const rows = await db
      .select()
      .from(comments)
      .where(sql`${comments.dropId} IN (${siteFamily(row.id)})`)
      .orderBy(asc(comments.n))
    const extras = await commentExtras(rows, siteFamily(row.id))
    return rows.map((item) => toComment(item, who, 1, extras))
  }
  const rows = await db
    .select({ comment: comments, version: drops.version })
    .from(comments)
    .innerJoin(drops, eq(drops.id, comments.dropId))
    .where(and(sql`${comments.dropId} IN (${chainOf(row)})`, lte(drops.version, row.version)))
    .orderBy(asc(comments.n), asc(drops.version))
  const extras = await commentExtras(
    rows.map((item) => item.comment),
    chainOf(row),
  )
  return rows.map((item) => toComment(item.comment, who, item.version, extras))
}

/**
 * The next comment number, counted across the version chain so a carried-over #3 and a new #3 can't meet, and
 * across a site's screenshots so the site's list has one #3.
 */
export const nextCommentNumber = (row: Pick<DropRow, "id" | "ownerId" | "kind" | "parentId">) =>
  sql<number>`(SELECT coalesce(max(n), 0) + 1 FROM comments WHERE drop_id IN (${chainOf(row)}) OR drop_id IN (${siteFamily(siteOf(row))}))`

/** Where a drop's comment numbers live: its version chain, or a site and its screenshots. */
const commentScope = (row: Pick<DropRow, "id" | "ownerId" | "kind">) =>
  sql`${comments.dropId} IN (${row.kind === "site" ? siteFamily(row.id) : chainOf(row)})`

/** Marks the open comments numbered `numbers` resolved, on any version of the drop. Returns the numbers it resolved. */
export async function resolveComments(row: Pick<DropRow, "id" | "ownerId" | "kind">, numbers: number[]) {
  const scope = commentScope(row)
  const open = await db
    .select({ n: comments.n })
    .from(comments)
    .where(and(scope, inArray(comments.n, numbers), eq(comments.resolved, false)))
  const resolved = [...new Set(open.map((comment) => comment.n))].sort((a, b) => a - b)
  if (resolved.length)
    await db
      .update(comments)
      .set({ resolved: true })
      .where(and(scope, inArray(comments.n, resolved)))
  return resolved
}

/** Comment #n on a drop: numbers count across the version chain, and across a site with its screenshots. */
export async function findCommentByNumber(row: Pick<DropRow, "id" | "ownerId" | "kind" | "parentId">, n: number) {
  const where =
    row.kind === "site"
      ? sql`${comments.dropId} IN (${siteFamily(row.id)})`
      : sql`${comments.dropId} IN (${chainOf(row)})`
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(where, eq(comments.n, n)))
    .limit(1)
  return comment ?? null
}

/** Adds a reply to `comment`'s thread; the callers check who may. */
export async function addReply(comment: Pick<CommentRow, "id">, who: Identity | null, body: string) {
  const [row] = await db
    .insert(commentReplies)
    .values({
      id: crypto.randomUUID(),
      commentId: comment.id,
      body,
      authorId: who?.userId ?? null,
      authorName: who?.name ?? "Guest",
      createdAt: Date.now(),
    })
    .returning()
  return toReply(row!, who, await authorImages([row!]))
}
