import { and, count, desc, eq, like, or, type SQL, sql } from "drizzle-orm"
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
import { decodeInk } from "#shared/ink"
import { commentsSchema } from "vite-hub/comments/database"
import { db } from "vite-hub/database"
import type { CommentAgent, CommentAttachment, CommentReply, DropComment } from "#shared/types"
import comments, { peopleByIds } from "../comments"
import { commentCleanup, drops } from "../databases/default/index"
import { attachmentsUnder, deleteImages, toAttachment } from "./comment-images"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"
import { background } from "./logs"

type Commented = Pick<DropRow, "id" | "kind" | "parentId" | "version"> & {
  ancestors?: Pick<DropRow, "id" | "kind">[]
}

interface CommentList {
  subject: CommentSubject
  shot: boolean
  parents: SQL
}

const scopeOf = (subject: CommentSubject) => `${subject.kind}:${subject.id}`

export const siteCommentList = (site: Pick<DropRow, "id">, shot = false): CommentList => ({
  subject: { kind: "site", id: site.id },
  shot,
  parents: sql`${site.id}`,
})

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

async function commentList(row: Commented): Promise<CommentList> {
  if (row.kind === "image" && row.parentId && (await parentKind({ ...row, parentId: row.parentId })) === "site")
    return siteCommentList({ id: row.parentId }, true)
  return ownList(row)
}

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
  pdfPage: v.optional(v.nullable(v.number()), null),
  ink: v.optional(v.nullable(v.string()), null),
  label: v.nullable(v.string()),
  page: v.nullable(v.string()),
  elementX: v.nullable(v.number()),
  elementY: v.nullable(v.number()),
  requestId: v.optional(v.string()),
  requestPending: v.optional(v.boolean()),
})
type CommentMeta = v.InferOutput<typeof CommentMeta>
export type DropThread = CommentThread & { meta: CommentMeta; version: number }

function dropThread(thread: CommentThread): DropThread | null {
  if (thread.subject.kind !== "drop" && thread.subject.kind !== "site") return null
  const parsed = v.safeParse(CommentMeta, thread.metadata)
  return parsed.success ? { ...thread, meta: parsed.output, version: thread.revision ?? 1 } : null
}

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

function commentsFailure(error: Error & { code: string }) {
  if (error.code === "COMMENTS_INVALID_INPUT")
    return new HTTPError({ status: 400, statusText: error.message, cause: error })
  return new HTTPError({ status: 503, statusText: "Comments are temporarily unavailable.", cause: error })
}

async function done(pending: Promise<[error: (Error & { code: string }) | undefined, ...unknown[]]>) {
  const [error] = await pending
  if (error) throw commentsFailure(error)
}

export function authorOf(who: Identity | null, name: string, guest: string | null = null): CommentUser {
  const shown = name.trim() || "Guest"
  if (!who) return { id: guest ?? `guest:${crypto.randomUUID()}`, name: shown, guest: true }
  return { id: who.userId, name: shown, ...(who.image && who.image.length <= 2048 ? { image: who.image } : {}) }
}

export const TOO_MANY_COMMENTS = "Too many comments in a minute. Wait a moment and send again."

export function actorOf(who: Identity | null): CommentActor | undefined {
  if (who?.actorKind !== "agent") return undefined
  const agent = knownAgent(who.actorName)
  const name = agent?.label ?? (who.actorName.trim().slice(0, 80) || "Agent")
  return { id: agent?.key ?? name.toLowerCase(), name }
}

function agentOf(actor: CommentActor | undefined): CommentAgent | null {
  if (!actor) return null
  const name = actor.name ?? actor.id
  return { name, image: knownAgent(actor.id)?.logo ?? knownAgent(name)?.logo ?? null }
}

export type Reader = string | null
export const readerOf = (who: Identity | null, guest: string | null = null): Reader => who?.userId ?? guest

const isMine = (author: CommentUser, reader: Reader) => reader !== null && author.id === reader
export const wroteThread = (thread: CommentThread, reader: Reader) => isMine(thread.author, reader)
export const wroteMessage = (message: CommentMessage, reader: Reader) => isMine(message.author, reader)

type Attachments = Map<string, CommentAttachment>
const filesOf = (message: CommentMessage | undefined, attachments: Attachments) =>
  (message?.attachments ?? []).flatMap((id) => attachments.get(id) ?? [])

export const toReply = (message: CommentMessage, reader: Reader, attachments: Attachments): CommentReply => ({
  id: message.id,
  body: message.body,
  authorId: message.author.id,
  authorName: message.author.name ?? "Guest",
  authorImage: message.author.image ?? null,
  agent: agentOf(message.actor),
  createdAt: message.createdAt,
  editedAt: message.editedAt ?? null,
  mentions: message.mentions,
  mine: isMine(message.author, reader),
  attachments: filesOf(message, attachments),
})

type Named = Map<string, CommentUser>

export async function mentionedIn(threads: CommentThread[]): Promise<Named> {
  const ids = [...new Set(threads.flatMap((thread) => thread.messages.flatMap((message) => message.mentions)))]
  return new Map((await peopleByIds(ids)).map((person) => [person.id, person]))
}

export function toComment(
  thread: DropThread,
  reader: Reader,
  attachments: Attachments,
  named: Named = new Map(),
): DropComment {
  const [first, ...replies] = thread.messages
  const { meta } = thread
  const mine = isMine(thread.author, reader)
  const requestId = mine ? (thread.requestId ?? meta.requestId) : undefined
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
    pdfPage: meta.pdfPage,
    ink: decodeInk(meta.ink),
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
    mine,
    ...(requestId ? { requestId } : {}),
    replies: replies.map((reply) => toReply(reply, reader, attachments)),
    attachments: filesOf(first, attachments),
    people: [...new Set(thread.messages.flatMap((message) => message.mentions))].flatMap((id) => {
      const person = named.get(id)
      return person ? [{ id, name: person.name ?? id, image: person.image ?? null }] : []
    }),
  }
}

async function threadsOf(list: CommentList, version?: number) {
  const [error, threads] = await comments.list({
    subject: list.subject,
    limit: 500,
    ...(version === undefined ? {} : { revision: { lte: version } }),
  })
  if (error) throw commentsFailure(error)
  return threads.flatMap((thread) => dropThread(thread) ?? [])
}

async function openThreadsOf(list: CommentList, version?: number) {
  const all: CommentThread[] = []
  let before: { updatedAt: number; id: string } | undefined
  for (let page = 0; ; page++) {
    const [error, threads] = await comments.list({
      subject: list.subject,
      status: "open",
      limit: page < 20 ? 500 : 1,
      ...(version === undefined ? {} : { revision: { lte: version } }),
      ...(before ? { before } : {}),
    })
    if (error) throw commentsFailure(error)
    if (page === 20 && threads.length) break
    all.push(...threads)
    const last = threads.at(-1)
    if (threads.length < 500 || !last) return all.flatMap((thread) => dropThread(thread) ?? [])
    before = { updatedAt: last.updatedAt, id: last.id }
  }
  throw new HTTPError({ status: 503, statusText: "More than 10,000 comments are open; not all could be read" })
}

async function imagesOf(list: CommentList): Promise<Attachments> {
  return new Map((await attachmentsUnder(list.parents)).map((file) => [file.id, toAttachment(file)]))
}

export async function threadsFor(row: Commented, { open = false } = {}) {
  const list = await commentList(row)
  const version = list.subject.kind === "drop" ? row.version : undefined
  const [threads, attachments] = await Promise.all([
    open ? openThreadsOf(list, version) : threadsOf(list, version),
    imagesOf(list),
  ])
  return { threads: list.shot ? threads.filter((thread) => thread.meta.dropId === row.id) : threads, attachments }
}

export async function openByPage(row: Commented, within?: string) {
  const list = await commentList(row)
  const threads = await openThreadsOf(list, list.subject.kind === "drop" ? row.version : undefined)
  const pages = new Map<string, { n: number; answered: boolean }[]>()
  for (const thread of threads.sort((a, b) => a.n - b.n)) {
    if (list.shot && thread.meta.dropId !== row.id) continue
    if (within && !thread.meta.page?.startsWith(within)) continue
    const page = (thread.meta.page ?? "").replace(/[?#].*$/, "")
    pages.set(page, [...(pages.get(page) ?? []), { n: thread.n, answered: answeredByAgent(thread) }])
  }
  return pages
}

const answeredByAgent = (thread: { messages: { actor?: CommentActor }[] }) =>
  thread.messages.length > 1 && Boolean(thread.messages.at(-1)?.actor)

export async function listComments(row: Commented, reader: Reader) {
  const { threads, attachments } = await threadsFor(row)
  const named = await mentionedIn(threads)
  return threads.sort((a, b) => a.n - b.n).map((thread) => toComment(thread, reader, attachments, named))
}

export async function toolbarThreadsOn(dropId: string): Promise<{ page: string; open: number }[]> {
  const threads = commentsSchema.vitehubCommentThreads
  const open = count()
  return db
    .select({ page: threads.subjectId, open })
    .from(threads)
    .where(
      and(
        eq(threads.subjectKind, "page"),
        or(
          eq(threads.subjectId, `/d/${dropId}`),
          like(threads.subjectId, `/d/${dropId}/%`),
          eq(threads.subjectId, `/drops/${dropId}`),
        ),
        eq(threads.status, "open"),
      ),
    )
    .groupBy(threads.subjectId)
    .orderBy(desc(open), threads.subjectId)
}

export async function addThread(
  row: Commented,
  input: {
    fields: Omit<v.InferInput<typeof CommentMeta>, "dropId">
    body: string
    author: CommentUser
    actor?: CommentActor
    mentions?: string[]
    attachments?: string[]
    requestId?: string
  },
  list?: CommentList,
): Promise<DropThread> {
  const meta: CommentMeta = { suggestion: null, at: null, pdfPage: null, ink: null, dropId: row.id, ...input.fields }
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
    ...(input.requestId ? { requestId: input.requestId } : {}),
  })
  if (error) throw commentsFailure(error)
  return { ...thread, meta, version: row.version }
}

const takenKey = () =>
  new HTTPError({ status: 409, statusText: "Another comment was sent with this request id. Send a new one." })

const sameSender = (first: CommentUser, author: CommentUser, guest: string | null) =>
  first.id === author.id || (guest !== null && first.id === guest)

export async function earlierThread(
  row: Commented,
  requestId: string,
  author: CommentUser,
  guest: string | null = null,
) {
  const [error, found] = await comments.findThread({ subject: (await commentList(row)).subject, requestId })
  if (error) throw commentsFailure(error)
  const thread = found ? dropThread(found) : null
  if (thread && !sameSender(thread.author, author, guest)) throw takenKey()
  return thread
}

export async function earlierReply(
  thread: CommentThread,
  requestId: string,
  author: CommentUser,
  guest: string | null = null,
) {
  const [error, found] = await comments.findReply(thread.id, requestId)
  if (error) throw commentsFailure(error)
  if (found && !sameSender(found.author, author, guest)) throw takenKey()
  return found
}

export async function findThread(id: string) {
  const [error, thread] = await comments.get(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  return thread ? dropThread(thread) : null
}

export async function findMessage(id: string) {
  const [error, found] = await comments.getByMessage(id)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  const thread = found ? dropThread(found) : null
  const message = thread?.messages.find((item) => item.id === id)
  return thread && message ? { thread, message, first: thread.messages[0]?.id === id } : null
}

export async function findReply(id: string) {
  const found = await findMessage(id)
  return found && !found.first ? { thread: found.thread, reply: found.message } : null
}

export async function findCommentByNumber(row: Commented, n: number, list?: CommentList) {
  const where = list ?? (await commentList(row))
  const [error, thread] = await comments.getByNumber(scopeOf(where.subject), n)
  if (error && error.code !== "COMMENTS_NOT_FOUND") throw commentsFailure(error)
  const own = thread ? dropThread(thread) : null
  return own && (!where.shot || own.meta.dropId === row.id) ? own : null
}

export async function resolveComments(row: Commented, numbers: number[], who: Identity) {
  const list = await commentList(row)
  const threads = await Promise.all([...new Set(numbers)].map((n) => findCommentByNumber(row, n, list)))
  const open = threads.flatMap((thread) => (thread?.status === "open" ? [thread] : []))
  const by = authorOf(who, who.name)
  for (const thread of open) await done(comments.resolve(thread.id, { by }))
  return open.map((thread) => thread.n).sort((a, b) => a - b)
}

export async function setResolved(thread: CommentThread, resolved: boolean, who: Identity | null) {
  if (resolved) return done(comments.resolve(thread.id, { by: authorOf(who, who?.name ?? "Guest") }))
  await done(comments.reopen(thread.id))
}

export async function replyTo(
  thread: CommentThread,
  author: CommentUser,
  body: string,
  extra: { actor?: CommentActor; mentions?: string[]; attachments?: string[]; requestId?: string } = {},
) {
  const [error, message] = await comments.reply(
    thread.id,
    {
      body,
      author,
      ...(extra.actor ? { actor: extra.actor } : {}),
      ...(extra.mentions?.length ? { mentions: extra.mentions } : {}),
      ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
      ...(extra.requestId ? { requestId: extra.requestId } : {}),
    },
    { allowResolved: true },
  )
  if (error) throw commentsFailure(error)
  return message
}

export const addReply = async (thread: CommentThread, who: Identity, body: string) =>
  toReply(await replyTo(thread, authorOf(who, who.name), body, { actor: actorOf(who) }), who.userId, new Map())

export async function editMessage(message: CommentMessage, body: string, mentions: string[] = []) {
  const [error, edited] = await comments.edit(message.id, { body, mentions })
  if (error) throw commentsFailure(error)
  return edited
}

export async function removeThread(thread: CommentThread) {
  await deleteImages(thread.messages.flatMap((message) => message.attachments))
  await done(comments.remove(thread.id))
}

export async function removeReply(reply: CommentMessage) {
  await deleteImages(reply.attachments)
  await done(comments.removeMessage(reply.id))
}

export async function commentCleanupFor(row: Commented) {
  const { subject, shot } = await commentList(row)
  return { scope: scopeOf(subject), shot }
}

async function removeQueuedComments(pending: typeof commentCleanup.$inferSelect) {
  if (!pending.shot) {
    await done(comments.removeScope(pending.scope))
    return
  }
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

export async function drainCommentCleanup() {
  const pending = await db.select().from(commentCleanup).orderBy(commentCleanup.createdAt).limit(20)
  for (const item of pending) {
    try {
      await removeQueuedComments(item)
      await db.delete(commentCleanup).where(eq(commentCleanup.dropId, item.dropId))
    } catch (error) {
      background.error({ action: "comment-cleanup", drop: item.dropId, error: String(error) })
    }
  }
}
