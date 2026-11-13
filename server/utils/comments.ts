import { and, eq, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { HTTPError } from "h3"
import * as v from "valibot"
import type {
  CommentActor,
  CommentAnchor,
  CommentMessage,
  CommentSubject,
  CommentThread,
  CommentUser,
} from "vite-hub/comments"
import { knownAgent } from "#shared/agents"
import { commentsSchema } from "vite-hub/comments/database"
import { db } from "vite-hub/database/drizzle"
import type { CommentAgent, CommentAttachment, CommentReply, DropComment } from "#shared/types"
import comments, { peopleByIds } from "../comments"
import { commentCleanup, drops } from "../databases/config"
import { attachmentsUnder, deleteImages, toAttachment } from "./comment-images"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"

/**
 * Drop's comments are ViteHub Comments threads (server/comments.ts). A thread's first message is the comment, the rest
 * are its replies, `revision` is the version it was written on, and `metadata` keeps where Drop's viewers draw it
 * (CommentMeta). Comments methods don't check who may: the routes do, with `permissions` and review tokens.
 */

/** A drop as the comment helpers need it. Rows from `findDrop` carry their ancestors, which saves a query for images. */
type Commented = Pick<DropRow, "id" | "kind" | "parentId" | "version"> & {
  ancestors?: Pick<DropRow, "id" | "kind">[]
}

/**
 * What a drop's comments are about, so "#3" names one comment: a doc across its versions, which share one id
 * (`{ kind: "drop" }`), or a site with the screenshots sent from it (`{ kind: "site" }`). `shot` marks a screenshot
 * (any image of a site): its own view shows only its own comments, numbered with the site's. `parents` selects the drops
 * that hold the list's comment images.
 */
interface CommentList {
  subject: CommentSubject
  shot: boolean
  parents: SQL
}

/** The numbering scope of a subject, as server/comments.ts defines it. */
const scopeOf = (subject: CommentSubject) => `${subject.kind}:${subject.id}`

/** A site's list, which takes in its screenshots'. `shot` for a screenshot's own view of it. */
export const siteCommentList = (site: Pick<DropRow, "id">, shot = false): CommentList => ({
  subject: { kind: "site", id: site.id },
  shot,
  parents: sql`${site.id}`,
})

/** A drop's own list: a site's, or a doc's across every version, under its stable id. */
const ownList = (row: Commented): CommentList =>
  row.kind === "site"
    ? siteCommentList(row)
    : { subject: { kind: "drop", id: row.id }, shot: false, parents: sql`${row.id}` }

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

/**
 * What a thread keeps in `metadata`: the drop it was written on, and its anchor as Drop's viewers draw it. `kind`:
 * `text` quotes a selection, `image` pins a spot or area on an image, `area` marks a rectangle of a page, `page` is the
 * whole page. `ox`/`oy`/`ow`/`oh` are thousandths of the anchor's box. `suggestion` holds a suggested edit's words.
 * `at` is the second of a video's frame an `image` comment is on.
 * `elementX`/`elementY` place a site review pin on the element `label` names, in thousandths of its box.
 */
const CommentMeta = v.object({
  dropId: v.string(),
  kind: v.picklist(["text", "image", "area", "page"]),
  selector: v.string(),
  ox: v.number(),
  oy: v.number(),
  ow: v.number(),
  oh: v.number(),
  quote: v.nullable(v.string()),
  suggestion: v.optional(v.nullable(v.string()), null),
  at: v.optional(v.nullable(v.number()), null),
  label: v.nullable(v.string()),
  page: v.nullable(v.string()),
  elementX: v.nullable(v.number()),
  elementY: v.nullable(v.number()),
  requestId: v.optional(v.string()),
  requestPending: v.optional(v.boolean()),
})
type CommentMeta = v.InferOutput<typeof CommentMeta>
export type DropThread = CommentThread & { meta: CommentMeta; version: number }

/** A thread of Drop's, or null for one of another subject, such as the comments on Drop's own pages. */
function dropThread(thread: CommentThread): DropThread | null {
  if (thread.subject.kind !== "drop" && thread.subject.kind !== "site") return null
  const parsed = v.safeParse(CommentMeta, thread.metadata)
  return parsed.success ? { ...thread, meta: parsed.output, version: thread.revision ?? 1 } : null
}

/**
 * The anchor ViteHub's own surfaces (the Console, MCP) read. Drop's viewers draw from `metadata`, which has the
 * frame's coordinates; this is the same place in ViteHub's terms.
 */
function anchorOf(meta: Omit<CommentMeta, "dropId">): CommentAnchor {
  const selector = meta.selector || "body"
  if (meta.kind === "page") return { kind: "page" }
  if (meta.kind === "text" && meta.quote)
    return { kind: "text", selector, exact: meta.quote.slice(0, 2000), prefix: "", suffix: "" }
  const box = meta.ow > 0 && meta.oh > 0 ? { width: meta.ow, height: meta.oh } : null
  if (meta.kind === "image") return { kind: "image", selector, x: meta.ox, y: meta.oy, ...box }
  return box
    ? { kind: "area", selector, x: meta.ox, y: meta.oy, ...box }
    : { kind: "element", selector, x: meta.ox, y: meta.oy }
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
export function authorOf(who: Identity | null, name: string): CommentUser {
  const shown = name.trim() || "Guest"
  if (!who) return { id: `guest:${crypto.randomUUID()}`, name: shown, guest: true }
  return { id: who.userId, name: shown, ...(who.image && who.image.length <= 2048 ? { image: who.image } : {}) }
}

/**
 * The agent that writes for `who`, when they came through an MCP client: its comments show the agent, with the person
 * beside it. Known clients get their short name ("Claude Code (drop)" is Claude); others keep the name they registered.
 */
export function actorOf(who: Identity | null): CommentActor | undefined {
  if (who?.actorKind !== "agent") return undefined
  const agent = knownAgent(who.actorName)
  const name = agent?.label ?? (who.actorName.trim().slice(0, 80) || "Agent")
  return { id: agent?.key ?? name.toLowerCase(), name }
}

/** What Drop's API says about the agent that wrote a message, with its logo when Drop knows the agent. */
function agentOf(actor: CommentActor | undefined): CommentAgent | null {
  if (!actor) return null
  const name = actor.name ?? actor.id
  return { name, image: knownAgent(actor.id)?.logo ?? knownAgent(name)?.logo ?? null }
}

const isMine = (author: CommentUser, who: Identity | null) => Boolean(who && author.id === who.userId)
/** Whether `who` wrote the thread's first message, which lets them resolve or delete it. */
export const wroteThread = (thread: CommentThread, who: Identity | null) => isMine(thread.author, who)
export const wroteMessage = (message: CommentMessage, who: Identity | null) => isMine(message.author, who)

/** Comment images by their drop id, which messages list in `attachments`. */
type Attachments = Map<string, CommentAttachment>
const filesOf = (message: CommentMessage | undefined, attachments: Attachments) =>
  (message?.attachments ?? []).flatMap((id) => attachments.get(id) ?? [])

export const toReply = (message: CommentMessage, who: Identity | null, attachments: Attachments): CommentReply => ({
  id: message.id,
  body: message.body,
  authorId: message.author.id,
  authorName: message.author.name ?? "Guest",
  authorImage: message.author.image ?? null,
  agent: agentOf(message.actor),
  createdAt: message.createdAt,
  editedAt: message.editedAt ?? null,
  mentions: message.mentions,
  mine: isMine(message.author, who),
  attachments: filesOf(message, attachments),
})

/** The people a thread's messages mention, by id. */
type Named = Map<string, CommentUser>

/** Who the threads' `@`s name, so a reader who can't list people still sees their names. One query, when any. */
export async function mentionedIn(threads: CommentThread[]): Promise<Named> {
  const ids = [...new Set(threads.flatMap((thread) => thread.messages.flatMap((message) => message.mentions)))]
  return new Map((await peopleByIds(ids)).map((person) => [person.id, person]))
}

/** A thread as Drop's API answers it (DropComment), with the version it was written on. */
export function toComment(
  thread: DropThread,
  who: Identity | null,
  attachments: Attachments,
  named: Named = new Map(),
): DropComment {
  const [first, ...replies] = thread.messages
  const { meta } = thread
  return {
    id: thread.id,
    messageId: first?.id ?? thread.id,
    n: thread.n,
    kind: meta.kind,
    selector: meta.selector,
    ox: meta.ox,
    oy: meta.oy,
    ow: meta.ow,
    oh: meta.oh,
    quote: meta.quote,
    suggestion: meta.suggestion,
    at: meta.at,
    label: meta.label,
    page: meta.page,
    body: first?.body ?? "",
    authorId: thread.author.id,
    authorName: thread.author.name ?? "Guest",
    authorImage: thread.author.image ?? null,
    agent: agentOf(first?.actor ?? thread.actor),
    mentions: first?.mentions ?? [],
    resolved: thread.status === "resolved",
    resolvedAt: thread.resolvedAt ?? null,
    createdAt: thread.createdAt,
    editedAt: first?.editedAt ?? null,
    version: thread.version,
    mine: isMine(thread.author, who),
    replies: replies.map((reply) => toReply(reply, who, attachments)),
    attachments: filesOf(first, attachments),
    people: [...new Set(thread.messages.flatMap((message) => message.mentions))].flatMap((id) => {
      const person = named.get(id)
      return person ? [{ id, name: person.name ?? id, image: person.image ?? null }] : []
    }),
  }
}

/**
 * Every thread of a list, newest activity first: for a doc, those written on `version` or before it. Comments reads
 * at most 500 threads at once, so a list with more shows its 500 most active.
 */
async function threadsOf(list: CommentList, version?: number) {
  const [error, threads] = await comments.list({
    subject: list.subject,
    limit: 500,
    ...(version === undefined ? {} : { revision: { lte: version } }),
  })
  if (error) throw commentsFailure(error)
  return threads.flatMap((thread) => dropThread(thread) ?? [])
}

/** The images of a list's comments and replies, by id. Read beside the threads, not after them. */
async function imagesOf(list: CommentList): Promise<Attachments> {
  return new Map((await attachmentsUnder(list.parents)).map((file) => [file.id, toAttachment(file)]))
}

/**
 * The threads and images of a list. A site lists all of them, with its screenshots'; a screenshot only its own. A
 * version lists its own and those of every version before it: a comment stays with the doc until someone resolves it.
 */
export async function threadsFor(row: Commented) {
  const list = await commentList(row)
  const [threads, attachments] = await Promise.all([
    threadsOf(list, list.subject.kind === "drop" ? row.version : undefined),
    imagesOf(list),
  ])
  return { threads: list.shot ? threads.filter((thread) => thread.meta.dropId === row.id) : threads, attachments }
}

/**
 * A version's comments and those of every version before it, by number. The viewer decides which of the older ones
 * still fit the page (see `outdated` in DropViewer.vue). A site's list takes in its screenshots'.
 */
export async function listComments(row: Commented, who: Identity | null) {
  const { threads, attachments } = await threadsFor(row)
  const named = await mentionedIn(threads)
  return threads.sort((a, b) => a.n - b.n).map((thread) => toComment(thread, who, attachments, named))
}

/** Starts a thread on `row`'s list, on its version. `attachments` are the ids of images already stored for it. */
export async function addThread(
  row: Commented,
  input: {
    fields: Omit<v.InferInput<typeof CommentMeta>, "dropId">
    body: string
    author: CommentUser
    actor?: CommentActor
    mentions?: string[]
    attachments?: string[]
  },
  list?: CommentList,
): Promise<DropThread> {
  const meta: CommentMeta = { suggestion: null, at: null, dropId: row.id, ...input.fields }
  const [error, thread] = await comments.create({
    subject: (list ?? (await commentList(row))).subject,
    anchor: anchorOf(meta),
    metadata: meta,
    revision: row.version,
    body: input.body,
    author: input.author,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  })
  if (error) throw commentsFailure(error)
  return { ...thread, meta, version: row.version }
}

/** A thread of Drop's by its id (DropComment `id`), or null. */
export async function findThread(id: string) {
  const [error, thread] = await comments.get(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  return thread ? dropThread(thread) : null
}

/** A message of Drop's by its id, with its thread, or null. The thread's first message is the comment itself. */
export async function findMessage(id: string) {
  const [error, found] = await comments.getByMessage(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  const thread = found ? dropThread(found) : null
  const message = thread?.messages.find((item) => item.id === id)
  return thread && message ? { thread, message, first: thread.messages[0]?.id === id } : null
}

/** A reply of Drop's by its id, with its thread, or null. DELETE /api/comments/<id> removes the comment itself. */
export async function findReply(id: string) {
  const found = await findMessage(id)
  return found && !found.first ? { thread: found.thread, reply: found.message } : null
}

/** Thread #n on a drop's list, or null. On a screenshot, only one of its own. */
export async function findCommentByNumber(row: Commented, n: number, list?: CommentList) {
  const where = list ?? (await commentList(row))
  const [error, thread] = await comments.getByNumber(scopeOf(where.subject), n)
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
  // Each resolution owns a write batch; don't overlap transactions on the same SQLite connection.
  for (const thread of open) await done(comments.resolve(thread.id, { by }))
  return open.map((thread) => thread.n).sort((a, b) => a - b)
}

/** Resolves or reopens a thread. */
export const setResolved = (thread: CommentThread, resolved: boolean, who: Identity | null) =>
  done(resolved ? comments.resolve(thread.id, { by: authorOf(who, who?.name ?? "Guest") }) : comments.reopen(thread.id))

/**
 * Adds a reply to a thread; the callers check who may. Drop takes replies on resolved threads too, and the thread
 * stays resolved.
 */
export async function replyTo(
  thread: CommentThread,
  author: CommentUser,
  body: string,
  extra: { actor?: CommentActor; mentions?: string[]; attachments?: string[] } = {},
) {
  const [error, message] = await comments.reply(
    thread.id,
    {
      body,
      author,
      ...(extra.actor ? { actor: extra.actor } : {}),
      ...(extra.mentions?.length ? { mentions: extra.mentions } : {}),
      ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
    },
    { allowResolved: true },
  )
  if (error) throw commentsFailure(error)
  return message
}

/** A reply with words only, as an agent sends it. */
export const addReply = async (thread: CommentThread, who: Identity, body: string) =>
  toReply(await replyTo(thread, authorOf(who, who.name), body, { actor: actorOf(who) }), who, new Map())

/** Changes the words of a message, by its author. Mentions are the ones the new words keep. */
export async function editMessage(message: CommentMessage, body: string, mentions: string[] = []) {
  const [error, edited] = await comments.edit(message.id, { body, mentions })
  if (error) throw commentsFailure(error)
  return edited
}

/** Deletes a thread with its replies and the images sent in it. */
export async function removeThread(thread: CommentThread) {
  await deleteImages(thread.messages.flatMap((message) => message.attachments))
  await done(comments.remove(thread.id))
}

/** Deletes a reply and its images. */
export async function removeReply(reply: CommentMessage) {
  await deleteImages(reply.attachments)
  await done(comments.removeMessage(reply.id))
}

/** Capture the scope while the drop and its parent still exist, to queue with permanent deletion. */
export async function commentCleanupFor(row: Commented) {
  const { subject, shot } = await commentList(row)
  return { scope: scopeOf(subject), shot }
}

/** Deletes a queued scope, or every thread of one screenshot in its site's shared scope. */
async function removeQueuedComments(pending: typeof commentCleanup.$inferSelect) {
  if (!pending.shot) {
    await done(comments.removeScope(pending.scope))
    return
  }
  // The viewer's 500-thread list is not exhaustive. Select only this screenshot's ids from the exported schema,
  // in bounded batches, and let the primitive remove each thread and its replies.
  const threads = commentsSchema.vitehubCommentThreads
  while (true) {
    const batch = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(eq(threads.scope, pending.scope), sql`json_extract(${threads.metadata}, '$.dropId') = ${pending.dropId}`),
      )
      .limit(50)
    if (!batch.length) return
    for (const thread of batch) {
      const [error] = await comments.remove(thread.id)
      if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
    }
  }
}

/** Retry deletions after requests or processes stop. A failure keeps the work for the next hourly cleanup. */
export async function drainCommentCleanup() {
  const pending = await db.select().from(commentCleanup).orderBy(commentCleanup.createdAt).limit(20)
  for (const item of pending) {
    try {
      await removeQueuedComments(item)
      await db.delete(commentCleanup).where(eq(commentCleanup.dropId, item.dropId))
    } catch (error) {
      log.error({ action: "comment-cleanup", drop: item.dropId, error: String(error) })
    }
  }
}
