import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { comments, drops, user } from "../databases/config"
import type { DropComment } from "#shared/types"
import type { DropRow } from "./drops"
import { chainOf } from "./expiry"
import type { Identity } from "./identity"

export type CommentRow = typeof comments.$inferSelect

/** `images`: the authors' pictures by user id (authorImages), for the pins and threads. */
export const toComment = (row: CommentRow, who: Identity | null, version: number, images?: Map<string, string | null>): DropComment => ({
  id: row.id, n: row.n, kind: row.kind, selector: row.selector, ox: row.ox, oy: row.oy, ow: row.ow, oh: row.oh, quote: row.quote, label: row.label,
  page: row.page, body: row.body, authorName: row.authorName, authorImage: (row.authorId && images?.get(row.authorId)) || null,
  resolved: row.resolved, createdAt: row.createdAt, version, mine: Boolean(who && row.authorId === who.userId),
})

/** The pictures of the people who wrote `rows`, in one query. Guests and agents without one get initials. */
export async function authorImages(rows: Pick<CommentRow, "authorId">[]) {
  const ids = [...new Set(rows.map(row => row.authorId).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return new Map<string, string | null>()
  const people = await db.select({ id: user.id, image: user.image }).from(user).where(inArray(user.id, ids))
  return new Map(people.map(person => [person.id, person.image]))
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
    const rows = await db.select().from(comments).where(sql`${comments.dropId} IN (${siteFamily(row.id)})`).orderBy(asc(comments.n))
    const images = await authorImages(rows)
    return rows.map(item => toComment(item, who, 1, images))
  }
  const rows = await db.select({ comment: comments, version: drops.version }).from(comments).innerJoin(drops, eq(drops.id, comments.dropId))
    .where(and(sql`${comments.dropId} IN (${chainOf(row)})`, lte(drops.version, row.version)))
    .orderBy(asc(comments.n), asc(drops.version))
  const images = await authorImages(rows.map(item => item.comment))
  return rows.map(item => toComment(item.comment, who, item.version, images))
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
  const open = await db.select({ n: comments.n }).from(comments).where(and(scope, inArray(comments.n, numbers), eq(comments.resolved, false)))
  const resolved = [...new Set(open.map(comment => comment.n))].sort((a, b) => a - b)
  if (resolved.length) await db.update(comments).set({ resolved: true }).where(and(scope, inArray(comments.n, resolved)))
  return resolved
}
