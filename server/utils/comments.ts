import { and, asc, eq, lte, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { comments, drops } from "../databases/config"
import type { DropComment } from "#shared/types"
import type { DropRow } from "./drops"
import { chainOf } from "./expiry"
import type { Identity } from "./identity"

export type CommentRow = typeof comments.$inferSelect

export const toComment = (row: CommentRow, who: Identity | null, version: number): DropComment => ({
  id: row.id, n: row.n, kind: row.kind, selector: row.selector, ox: row.ox, oy: row.oy, ow: row.ow, oh: row.oh, quote: row.quote, label: row.label,
  page: row.page, body: row.body, authorName: row.authorName, resolved: row.resolved, createdAt: row.createdAt, version,
  mine: Boolean(who && row.authorId === who.userId),
})

/**
 * A version's comments and those of every version before it: a comment stays with the doc until someone resolves it.
 * The viewer decides which of the older ones still fit the page (see `outdated` in DropViewer.vue). Apps have no
 * versions, so theirs are always their own.
 */
export async function listComments(row: Pick<DropRow, "id" | "ownerId" | "version">, who: Identity | null) {
  const rows = await db.select({ comment: comments, version: drops.version }).from(comments).innerJoin(drops, eq(drops.id, comments.dropId))
    .where(and(sql`${comments.dropId} IN (${chainOf(row)})`, lte(drops.version, row.version)))
    .orderBy(asc(comments.n), asc(drops.version))
  return rows.map(item => toComment(item.comment, who, item.version))
}

/** The next comment number, counted across the version chain so a carried-over #3 and a new #3 can't meet. */
export const nextCommentNumber = (row: Pick<DropRow, "id" | "ownerId">) =>
  sql<number>`(SELECT coalesce(max(n), 0) + 1 FROM comments WHERE drop_id IN (${chainOf(row)}))`
