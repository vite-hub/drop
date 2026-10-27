import { and, asc, eq, inArray, lte, type SQL, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { commentReplies, comments, user } from "../databases/config"
import type { CommentAttachment, CommentReply, DropComment } from "#shared/types"
import { attachmentsOf, toAttachment } from "./comment-images"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"

export type CommentRow = typeof comments.$inferSelect

type ReplyRow = typeof commentReplies.$inferSelect
/**
 * What toComment adds from other tables: the authors' pictures by user id, each comment's replies, and the images
 * sent with each comment or reply, by the comment's or the reply's id.
 */
export type CommentExtras = {
  images: Map<string, string | null>
  replies: Map<string, ReplyRow[]>
  attachments?: Map<string, CommentAttachment[]>
}

const toReply = (row: ReplyRow, who: Identity | null, extras?: Partial<CommentExtras>): CommentReply => ({
  id: row.id,
  body: row.body,
  authorName: row.authorName,
  authorImage: (row.authorId && extras?.images?.get(row.authorId)) || null,
  createdAt: row.createdAt,
  mine: Boolean(who && row.authorId === who.userId),
  attachments: extras?.attachments?.get(row.id) ?? [],
})

export const toComment = (row: CommentRow, who: Identity | null, extras?: CommentExtras): DropComment => ({
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
  version: row.version,
  mine: Boolean(who && row.authorId === who.userId),
  replies: (extras?.replies.get(row.id) ?? []).map((reply) => toReply(reply, who, extras)),
  attachments: extras?.attachments?.get(row.id) ?? [],
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
 * Replies come oldest first, grouped by comment. Both read from the subquery alone, so they go with the comments' own
 * query rather than after it.
 */
export async function commentExtras(dropIds: SQL): Promise<CommentExtras> {
  const commented = sql`SELECT id FROM comments WHERE drop_id IN (${dropIds})`
  const [replies, people, files] = await Promise.all([
    db
      .select()
      .from(commentReplies)
      .where(sql`${commentReplies.commentId} IN (${commented})`)
      .orderBy(asc(commentReplies.createdAt)),
    db
      .select({ id: user.id, image: user.image })
      .from(user)
      .where(
        sql`${user.id} IN (SELECT author_id FROM comments WHERE drop_id IN (${dropIds}) UNION SELECT author_id FROM comment_replies WHERE comment_id IN (${commented}))`,
      ),
    attachmentsOf(commented),
  ])
  const byComment = new Map<string, ReplyRow[]>()
  for (const reply of replies) byComment.set(reply.commentId, [...(byComment.get(reply.commentId) ?? []), reply])
  const attachments = new Map<string, CommentAttachment[]>()
  for (const file of files) {
    const owner = file.replyId ?? file.commentId
    attachments.set(owner, [...(attachments.get(owner) ?? []), toAttachment(file)])
  }
  return { images: new Map(people.map((person) => [person.id, person.image])), replies: byComment, attachments }
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
export async function listComments(row: Pick<DropRow, "id" | "version" | "kind">, who: Identity | null) {
  const scope =
    row.kind === "site"
      ? sql`${comments.dropId} IN (${siteFamily(row.id)})`
      : and(eq(comments.dropId, row.id), lte(comments.version, row.version))!
  const [rows, extras] = await Promise.all([
    db.select().from(comments).where(scope).orderBy(asc(comments.n)),
    commentExtras(row.kind === "site" ? siteFamily(row.id) : sql`SELECT ${row.id}`),
  ])
  return rows.map((item) => toComment(item, who, extras))
}

/**
 * The next comment number, counted across the drop's versions so a carried-over #3 and a new #3 can't meet, and
 * across a site's screenshots so the site's list has one #3.
 */
export const nextCommentNumber = (row: Pick<DropRow, "id" | "kind" | "parentId">) =>
  sql<number>`(SELECT coalesce(max(n), 0) + 1 FROM comments WHERE drop_id = ${row.id} OR drop_id IN (${siteFamily(siteOf(row))}))`

/** Where a drop's comment numbers live: the drop, or a site and its screenshots. */
const commentScope = (row: Pick<DropRow, "id" | "kind">) =>
  row.kind === "site" ? sql`${comments.dropId} IN (${siteFamily(row.id)})` : eq(comments.dropId, row.id)

/** Marks the open comments numbered `numbers` resolved, on any version of the drop. Returns the numbers it resolved. */
export async function resolveComments(row: Pick<DropRow, "id" | "kind">, numbers: number[]) {
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

/** Comment #n on a drop: numbers count across its versions, and across a site with its screenshots. */
export async function findCommentByNumber(row: Pick<DropRow, "id" | "kind">, n: number) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(commentScope(row), eq(comments.n, n)))
    .limit(1)
  return comment ?? null
}

/** Adds a reply to `comment`'s thread; the callers check who may. `name` is a guest's, from a review token. */
export async function insertReply(comment: Pick<CommentRow, "id">, who: Identity | null, body: string, name?: string) {
  const [row] = await db
    .insert(commentReplies)
    .values({
      id: crypto.randomUUID(),
      commentId: comment.id,
      body,
      authorId: who?.userId ?? null,
      authorName: who?.name ?? name ?? "Guest",
      createdAt: Date.now(),
    })
    .returning()
  return row!
}

/** The reply as the thread shows it, with the images stored for it. */
export const replyOf = async (row: ReplyRow, who: Identity | null, attachments: CommentAttachment[]) =>
  toReply(row, who, { images: await authorImages([row]), attachments: new Map([[row.id, attachments]]) })

/** A reply with words only, as an agent sends it. */
export const addReply = async (comment: Pick<CommentRow, "id">, who: Identity | null, body: string) =>
  replyOf(await insertReply(comment, who, body), who, [])
