import { eq, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { HTTPError } from "h3"
import * as v from "valibot"
import type { Comment, CommentAuthor, CommentThread } from "vite-hub/comments"
import { db } from "vite-hub/database/drizzle"
import type { CommentAttachment, CommentReply, DropComment } from "#shared/types"
import { comments } from "../comments"
import { drops } from "../databases/config"
import { attachmentsUnder, deleteImagesOf, toAttachment } from "./comment-images"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"

/**
 * Drop's comments are ViteHub Comments threads (server/comments.ts). A thread's first comment is the comment, the rest
 * are its replies, and `metadata` keeps where it points (CommentMeta). Comments methods don't check who may: the
 * routes do, with `permissions` and review tokens, as before.
 */

/** A drop as the comment helpers need it. Rows from `findDrop` carry their ancestors, which saves a query for images. */
type Commented = Pick<DropRow, "id" | "kind" | "link" | "parentId" | "version"> & {
  ancestors?: Pick<DropRow, "id" | "kind">[]
}

/**
 * Where a drop's comments are numbered, so "#3" names one comment: a doc's version chain, which shares one link
 * (`drop:<link>`), or a site with the screenshots sent from it (`site:<id>`). `shot` marks a screenshot (any image of a
 * site): its own view shows only its own comments, numbered with the site's. `parents` selects the drops that hold the
 * list's comment images.
 */
interface CommentList {
  scope: string
  shot: boolean
  parents: SQL
}

/** A site's list, which takes in its screenshots'. `shot` for a screenshot's own view of it. */
export const siteCommentList = (site: Pick<DropRow, "id">, shot = false): CommentList => ({
  scope: `site:${site.id}`,
  shot,
  parents: sql`${site.id}`,
})

/** A drop's own list: a site's, or its version chain's. Every version of a doc has its link; a drop from before links has its id. */
const ownList = (row: Commented): CommentList =>
  row.kind === "site"
    ? siteCommentList(row)
    : {
        scope: `drop:${row.link ?? row.id}`,
        shot: false,
        parents: row.link ? sql`SELECT id FROM drops WHERE link = ${row.link}` : sql`${row.id}`,
      }

async function parentKind(row: Commented & { parentId: string }) {
  const known = row.ancestors?.find((node) => node.id === row.parentId)
  if (known) return known.kind
  const [parent] = await db.select({ kind: drops.kind }).from(drops).where(eq(drops.id, row.parentId)).limit(1)
  return parent?.kind
}

/** The list a drop's comments belong to. Only an image can be a site's screenshot, so only an image may cost a query. */
async function commentList(row: Commented): Promise<CommentList> {
  if (row.kind === "image" && row.parentId && (await parentKind({ ...row, parentId: row.parentId })) === "site")
    return siteCommentList({ id: row.parentId }, true)
  return ownList(row)
}

/** Where a new thread is, for the Comments API: the drop's link. Drop shows its threads only in its own views. */
const commentPage = (row: Pick<DropRow, "id" | "link">) => `/d/${row.link ?? row.id}`

/**
 * What a thread keeps in `metadata`: the drop and version it was written on, and its anchor as Drop's viewers draw it.
 * `kind`: `text` quotes a selection, `image` pins a spot or area on an image, `area` marks a rectangle of a page, `page`
 * is the whole page. `ox`/`oy`/`ow`/`oh` are thousandths of the anchor's box. `elementX`/`elementY` place a site
 * review pin on the element `label` names, in thousandths of its box.
 */
const CommentMeta = v.object({
  dropId: v.string(),
  version: v.number(),
  kind: v.picklist(["text", "image", "area", "page"]),
  selector: v.string(),
  ox: v.number(),
  oy: v.number(),
  ow: v.number(),
  oh: v.number(),
  quote: v.nullable(v.string()),
  label: v.nullable(v.string()),
  page: v.nullable(v.string()),
  elementX: v.nullable(v.number()),
  elementY: v.nullable(v.number()),
})
type CommentMeta = v.InferOutput<typeof CommentMeta>
type DropThread = CommentThread & { meta: CommentMeta }

/** A thread of Drop's, or null for one of another scope, such as the comments on Drop's own pages. */
function dropThread(thread: CommentThread): DropThread | null {
  if (!thread.scope.startsWith("drop:") && !thread.scope.startsWith("site:")) return null
  const parsed = v.safeParse(CommentMeta, thread.metadata)
  return parsed.success ? { ...thread, meta: parsed.output } : null
}

/** A Comments error as an HTTP error: bad input is the caller's, anything else Drop's. */
function commentsFailure(error: Error & { code: string }) {
  if (error.code === "COMMENTS_INVALID_INPUT")
    return new HTTPError({ status: 400, statusText: error.message, cause: error })
  log.error({ action: "comments", code: error.code, error: error.message })
  return new HTTPError({ status: 503, statusText: "Comments are temporarily unavailable.", cause: error })
}

/** Throws the error of a Comments call that returns no data. */
async function done(pending: Promise<[error: (Error & { code: string }) | undefined, ...unknown[]]>) {
  const [error] = await pending
  if (error) throw commentsFailure(error)
}

/**
 * Who writes a comment or reply. A guest (a "Can comment" link, or a review token without a person) gets an id of its
 * own, so no comment of theirs ever counts as anyone's. The picture is a copy, like the name.
 */
export function authorOf(who: Identity | null, name: string): CommentAuthor {
  const shown = name.trim() || "Guest"
  if (!who) return { id: `guest:${crypto.randomUUID()}`, name: shown, guest: true }
  return { id: who.userId, name: shown, ...(who.image && who.image.length <= 2048 ? { image: who.image } : {}) }
}

const isMine = (author: CommentAuthor, who: Identity | null) => Boolean(who && author.id === who.userId)
/** Whether `who` wrote the thread's first comment, which lets them resolve or delete it. */
export const wroteThread = (thread: CommentThread, who: Identity | null) => isMine(thread.createdBy, who)
export const wroteComment = (comment: Comment, who: Identity | null) => isMine(comment.author, who)

/** Images by the comment they're in: the thread's first comment, or a reply. */
type Attachments = Map<string, CommentAttachment[]>

export const toReply = (comment: Comment, who: Identity | null, attachments: Attachments): CommentReply => ({
  id: comment.id,
  body: comment.body,
  authorName: comment.author.name,
  authorImage: comment.author.image ?? null,
  createdAt: Date.parse(comment.createdAt),
  mine: isMine(comment.author, who),
  attachments: attachments.get(comment.id) ?? [],
})

/** A thread as Drop's API answers it (DropComment). `version` is the version it counts as written on. */
export function toComment(
  thread: DropThread,
  who: Identity | null,
  version: number,
  attachments: Attachments,
): DropComment {
  const [first, ...replies] = thread.comments
  const { meta } = thread
  return {
    id: thread.id,
    n: thread.number,
    kind: meta.kind,
    selector: meta.selector,
    ox: meta.ox,
    oy: meta.oy,
    ow: meta.ow,
    oh: meta.oh,
    quote: meta.quote,
    label: meta.label,
    page: meta.page,
    body: first?.body ?? "",
    authorName: thread.createdBy.name,
    authorImage: thread.createdBy.image ?? null,
    resolved: thread.status === "resolved",
    createdAt: Date.parse(thread.createdAt),
    version,
    mine: isMine(thread.createdBy, who),
    replies: replies.map((reply) => toReply(reply, who, attachments)),
    attachments: (first && attachments.get(first.id)) || [],
  }
}

/**
 * Every thread of a list, newest activity first. Comments reads at most 500 threads at once, so a list with more
 * shows its 500 most active.
 */
async function threadsOf(list: CommentList) {
  const [error, threads] = await comments.list({ scope: list.scope, limit: 500 })
  if (error) throw commentsFailure(error)
  return threads.flatMap((thread) => dropThread(thread) ?? [])
}

/** The images of a list's comments and replies, by the comment they're in. Read beside the threads, not after them. */
async function imagesOf(list: CommentList): Promise<Attachments> {
  const attachments: Attachments = new Map()
  for (const file of await attachmentsUnder(list.parents)) {
    const owner = file.replyId ?? file.commentId
    attachments.set(owner, [...(attachments.get(owner) ?? []), toAttachment(file)])
  }
  return attachments
}

/**
 * The threads and images of a list. A site lists all of them, with its screenshots'; a screenshot only its own. A
 * version lists its own and those of every version before it: a comment stays with the doc until someone resolves it.
 */
export async function threadsFor(row: Commented) {
  const list = await commentList(row)
  const [threads, attachments] = await Promise.all([threadsOf(list), imagesOf(list)])
  const shown = threads.filter((thread) =>
    list.shot
      ? thread.meta.dropId === row.id
      : row.kind === "site" || thread.meta.dropId === row.id || thread.meta.version <= row.version,
  )
  return { threads: shown, attachments }
}

/**
 * A thread counts as written on the version it names, except on the drop it's on: an app is republished in place, so
 * its comments are all its current version's.
 */
const versionOf = (thread: DropThread, row: Pick<DropRow, "id" | "version">) =>
  thread.meta.dropId === row.id ? row.version : thread.meta.version

/**
 * A version's comments and those of every version before it, by number. The viewer decides which of the older ones
 * still fit the page (see `outdated` in DropViewer.vue). A site's list takes in its screenshots'.
 */
export async function listComments(row: Commented, who: Identity | null) {
  const { threads, attachments } = await threadsFor(row)
  return threads
    .sort((a, b) => a.number - b.number)
    .map((thread) => toComment(thread, who, versionOf(thread, row), attachments))
}

/** Starts a thread on `row`'s list. `page` is where the Comments API files it; it defaults to the drop's link. */
export async function addThread(
  row: Commented,
  input: { fields: Omit<CommentMeta, "dropId" | "version">; body: string; author: CommentAuthor; page?: string },
  list?: CommentList,
): Promise<DropThread> {
  const meta: CommentMeta = { dropId: row.id, version: row.version, ...input.fields }
  const [error, thread] = await comments.create({
    scope: (list ?? (await commentList(row))).scope,
    page: input.page ?? commentPage(row),
    metadata: meta,
    body: input.body,
    author: input.author,
  })
  if (error) throw commentsFailure(error)
  return { ...thread, meta }
}

/** A thread of Drop's by its id (DropComment `id`), or null. */
export async function findThread(id: string) {
  const [error, thread] = await comments.get(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  return thread ? dropThread(thread) : null
}

/**
 * A reply of Drop's by its id, with its thread, or null. The thread's first comment is no reply: DELETE
 * /api/comments/<id> removes that.
 */
export async function findReply(id: string) {
  const [error, found] = await comments.getByComment(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  const thread = found ? dropThread(found) : null
  const reply = thread?.comments.slice(1).find((comment) => comment.id === id)
  return thread && reply ? { thread, reply } : null
}

/** Thread #n on a drop's list, or null. On a screenshot, only one of its own. */
export async function findCommentByNumber(row: Commented, n: number, list?: CommentList) {
  const where = list ?? (await commentList(row))
  const [error, thread] = await comments.getByNumber(where.scope, n)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  const own = thread ? dropThread(thread) : null
  return own && (!where.shot || own.meta.dropId === row.id) ? own : null
}

/** Resolves the open threads numbered `numbers` on any version of the drop. Returns the numbers it resolved. */
export async function resolveComments(row: Commented, numbers: number[], who: Identity) {
  const list = await commentList(row)
  const threads = await Promise.all([...new Set(numbers)].map((n) => findCommentByNumber(row, n, list)))
  const open = threads.flatMap((thread) => (thread?.status === "open" ? [thread] : []))
  const by = authorOf(who, who.name)
  await Promise.all(open.map((thread) => done(comments.resolve(thread.id, { by }))))
  return open.map((thread) => thread.number).sort((a, b) => a - b)
}

/** Resolves or reopens a thread. */
export const setResolved = (thread: CommentThread, resolved: boolean, who: Identity | null) =>
  done(resolved ? comments.resolve(thread.id, { by: authorOf(who, who?.name ?? "Guest") }) : comments.reopen(thread.id))

/**
 * Adds a reply to a thread; the callers check who may. Drop takes replies on resolved threads too, which Comments
 * doesn't: such a thread opens for the reply and resolves again, as its resolver left it.
 */
export async function replyTo(thread: CommentThread, author: CommentAuthor, body: string) {
  const reply = async () => {
    const [error, comment] = await comments.reply(thread.id, { body, author })
    if (error) throw commentsFailure(error)
    return comment
  }
  if (thread.status !== "resolved") return reply()
  await done(comments.reopen(thread.id))
  try {
    return await reply()
  } finally {
    await done(comments.resolve(thread.id, { by: thread.resolvedBy ?? author }))
  }
}

/** A reply with words only, as an agent sends it. */
export const addReply = async (thread: CommentThread, who: Identity, body: string) =>
  toReply(await replyTo(thread, authorOf(who, who.name), body), who, new Map())

/** Deletes a thread with its replies and the images sent in it. */
export async function removeThread(thread: CommentThread) {
  const first = thread.comments[0]
  if (first) await deleteImagesOf({ commentId: first.id })
  await done(comments.remove(thread.id))
}

/** Deletes a reply and its images. */
export async function removeReply(reply: Comment) {
  await deleteImagesOf({ replyId: reply.id })
  await done(comments.removeComment(reply.id))
}

/** Undoes a thread or a reply whose images couldn't be stored, so a retry doesn't post it twice. */
export const undoThread = (thread: CommentThread) => done(comments.remove(thread.id))
export const undoReply = (reply: Comment) => done(comments.removeComment(reply.id))

/**
 * Deletes the threads on a drop that is going for good, with every version (`ids`). A site or a version chain takes
 * its whole list. A screenshot takes only its own threads, unless its site goes too (`gone`), whose list goes then.
 * Their images are drops under the drop, which go with it.
 */
export async function removeCommentsOf(row: Commented, ids: string[], gone: Set<string>) {
  const list = row.parentId && gone.has(row.parentId) ? ownList(row) : await commentList(row)
  if (!list.shot) {
    await done(comments.removeScope(list.scope))
    return
  }
  const going = new Set(ids)
  for (const thread of await threadsOf(list)) if (going.has(thread.meta.dropId)) await done(comments.remove(thread.id))
}
