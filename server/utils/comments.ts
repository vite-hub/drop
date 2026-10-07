import { asc, eq } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { comments } from "../databases/config"
import type { DropComment } from "#shared/types"
import type { Identity } from "./identity"

export type CommentRow = typeof comments.$inferSelect

export const toComment = (row: CommentRow, who: Identity | null): DropComment => ({
  id: row.id, n: row.n, kind: row.kind, selector: row.selector, ox: row.ox, oy: row.oy, quote: row.quote, label: row.label,
  page: row.page, body: row.body, authorName: row.authorName, resolved: row.resolved, createdAt: row.createdAt,
  mine: Boolean(who && row.authorId === who.userId),
})

export const listComments = (dropId: string) => db.select().from(comments).where(eq(comments.dropId, dropId)).orderBy(asc(comments.n))
