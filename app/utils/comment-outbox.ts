import type { CommentDelivery, CommentsOutboxEntry, CommentsTransport, CommentThread } from "vite-hub/comments/client"
import type { CommentInput } from "#shared/schemas"
import type { CommentAttachment, CommentReply, DropComment } from "#shared/types"
import * as v from "valibot"

// Drop's comments through ViteHub's outbox (`createCommentsClient({ outbox })`): a new comment or reply is saved in the
// browser with its images, shows at once as the reader's, and goes to Drop's own routes once, with its `requestId`.

/** A new comment's anchor and kind, as the comment routes take it, without its words. */
export type CommentPlace = Omit<CommentInput, "body" | "mentions">

/** A comment drawn on a site in Drop's frame (ViewerSiteFrame): its page, box, and viewport, as POST /api/drops/:id/review takes them. */
export interface SiteCommentPlace {
  page: string
  ox: number
  oy: number
  ow: number
  oh: number
  viewport: { width: number; height: number }
}

/**
 * Where a waiting comment goes, kept in the entry's metadata: Comments metadata is flat, so the place is one JSON
 * string. `drop` is the drop whose list it joins; `v` the version its link pins, if any; `version` the one it's written on.
 */
type Target =
  | { route: "comment"; drop: string; v?: number; version: number; place: CommentPlace }
  | { route: "review"; drop: string; version: number; origin: string; place: SiteCommentPlace }

export function targetMetadata(target: Target) {
  const { route, drop, version } = target
  return {
    route,
    drop,
    version,
    ...(target.route === "comment" && target.v ? { v: target.v } : {}),
    ...(target.route === "review" ? { origin: target.origin } : {}),
    place: JSON.stringify(target.place),
  }
}

/** The metadata targetMetadata writes, as the outbox's store gives it back. */
const TargetMetadataSchema = v.object({
  route: v.optional(v.string()),
  drop: v.string(),
  version: v.optional(v.number(), 0),
  v: v.optional(v.number()),
  origin: v.optional(v.string()),
  place: v.string(),
})

function targetOf(metadata: Record<string, unknown> | undefined): Target | undefined {
  const parsed = v.safeParse(TargetMetadataSchema, metadata)
  if (!parsed.success) return undefined
  const { route, drop, version, v: at, origin } = parsed.output
  // doctor-disable-next-line typescript/boundaries/no-unvalidated-deserialization -- the JSON targetMetadata wrote in this browser's own outbox
  // SAFETY: `place` is the JSON targetMetadata wrote from a CommentPlace or a SiteCommentPlace, by `route`.
  const place = JSON.parse(parsed.output.place) as CommentPlace & SiteCommentPlace
  if (route === "review" && origin !== undefined) return { route: "review", drop, version, origin, place }
  return { route: "comment", drop, version, ...(at ? { v: at } : {}), place }
}

/** The drop a waiting entry's list is on. */
export const dropOf = (entry: CommentsOutboxEntry) =>
  entry.kind === "create" ? targetOf(entry.input.metadata)?.drop : entry.subject?.id

/** A comment's or reply's body: JSON, or multipart with the JSON in `data` when it carries images. */
function withImages(data: Record<string, unknown>, files: readonly Blob[]) {
  if (!files.length) return data
  const form = new FormData()
  form.append("data", JSON.stringify(data))
  for (const file of files) form.append("image", file, file instanceof File && file.name ? file.name : "image")
  return form
}

const field = (error: unknown, name: string): unknown =>
  error instanceof Object ? Reflect.get(error, name) : undefined
const answerOf = (error: unknown) => {
  const response = field(error, "response")
  return response instanceof Response ? response : undefined
}

const StatusSchema = v.pipe(v.number(), v.integer(), v.minValue(1))

/** The status a route answered a send with, or undefined when no answer came. */
export function statusOf(error: unknown) {
  const status = field(error, "status") ?? field(error, "statusCode") ?? answerOf(error)?.status
  return v.is(StatusSchema, status) ? status : undefined
}

/** What the outbox reads from a refusal: the status (none when there was no answer), the server's sentence, and its wait. */
function refusal(error: unknown) {
  const status = statusOf(error)
  const seconds = Number(answerOf(error)?.headers.get("retry-after") ?? Number.NaN)
  return Object.assign(new Error(errorText(error, "Couldn't send it. It waits and tries again.")), {
    ...(status ? { status } : {}),
    ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfter: seconds * 1000 } : {}),
    cause: error,
  })
}

/** Whose outbox a guest's browser keeps: one for every guest, since the server knows a guest by its cookie alone. */
export const GUEST_ACCOUNT = "guest"

interface DropTransportHost {
  fetch: typeof $fetch
  /**
   * The signed-in person who wrote what this transport sends, none for a guest. Each request carries it as `as`, and
   * the routes answer 401 when the session is somebody else, so a comment never goes out as another person.
   */
  as?: string
  /** The server took a comment: `comment` when the route answered it, else the drop whose list to load again. */
  created: (requestId: string, drop: string, comment: DropComment | null, threadId: string) => void | Promise<void>
  replied: (requestId: string, drop: string | undefined, threadId: string, reply: CommentReply) => void
  /** A refusal the plan-limit dialog explains, or another the reader should hear of. */
  refused: (error: unknown) => void
  /**
   * The person who wrote them is signed out: nothing goes out, and each entry is held as a 401 would hold it, until
   * they sign in again.
   */
  held?: boolean
}

const unused = () => Promise.reject(new Error("Drop's outbox only sends new comments and replies."))

/**
 * The outbox's transport: Drop's own routes, which keep the anchor, the screenshot and the suggestion, check sharing and
 * guests, and take the images with the comment. Only `create` and `reply` go through the outbox; the rest stay in useDrop.
 */
export function dropTransport(host: DropTransportHost): CommentsTransport {
  const as = host.as ? { as: host.as } : {}
  const send = async <T>(request: () => Promise<T>) => {
    if (host.held) throw Object.assign(new Error("Sign in again to send it."), { status: 401 })
    try {
      return await request()
    } catch (error) {
      host.refused(error)
      throw refusal(error)
    }
  }
  return {
    supportsAttachments: false,
    list: async () => [],
    get: async () => null,
    async create(input) {
      const target = targetOf(input.metadata)
      const requestId = input.requestId
      if (!target || !requestId)
        throw Object.assign(new Error("This comment lost where it goes. Copy its words and write it again."), {
          status: 400,
        })
      const files = input.files ?? []
      if (target.route === "review") {
        const [screenshot, ...images] = files
        const form = new FormData()
        form.append("data", JSON.stringify({ ...target.place, body: input.body, requestId, ...as }))
        if (screenshot) form.append("screenshot", screenshot, "screenshot")
        for (const file of images) form.append("image", file, file instanceof File && file.name ? file.name : "image")
        const { n, id } = await send(() =>
          host.fetch<{ n: number; id: string }>(`/api/drops/${target.drop}/review`, {
            method: "POST",
            query: { origin: target.origin },
            body: form,
          }),
        )
        await host.created(requestId, target.drop, null, id)
        return {
          id,
          scope: "",
          n,
          subject: input.subject,
          anchor: input.anchor,
          status: "open",
          author: { id: "" },
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          requestId,
        } satisfies CommentThread
      }
      const comment = await send(() =>
        host.fetch<DropComment>(`/api/drops/${target.drop}/comments`, {
          method: "POST",
          query: target.v ? { v: target.v } : {},
          body: withImages(
            { ...target.place, body: input.body, mentions: input.mentions ?? [], requestId, ...as },
            files,
          ),
        }),
      )
      const landed = { ...comment, requestId }
      await host.created(requestId, target.drop, landed, landed.id)
      // The subject stays the outbox's, which names the drop whose list the comment and its waiting replies are on.
      return { ...toThread(landed, input.subject), requestId }
    },
    async reply(input) {
      const requestId = input.requestId ?? ""
      const reply = await send(() =>
        host.fetch<CommentReply>(`/api/comments/${input.threadId}/replies`, {
          method: "POST",
          body: withImages({ body: input.body, mentions: input.mentions ?? [], requestId, ...as }, input.files ?? []),
        }),
      )
      host.replied(requestId, input.subject?.id, input.threadId, { ...reply, requestId })
      return toThread(
        { ...emptyComment(input.threadId), replies: [{ ...reply, requestId }] },
        input.subject ?? { kind: "drop", id: "" },
      )
    },
    edit: unused,
    delete: unused,
    resolve: unused,
    reopen: unused,
    users: async () => [],
  }
}

/** A stand-in for a reply's thread when the outbox needs one: the server's own copy comes with the next list. */
function emptyComment(id: string): DropComment {
  return {
    id,
    messageId: id,
    n: 0,
    kind: "page",
    selector: "",
    ox: 0,
    oy: 0,
    ow: 0,
    oh: 0,
    quote: null,
    suggestion: null,
    at: null,
    pdfPage: null,
    ink: null,
    label: null,
    page: null,
    body: "",
    authorId: "",
    authorName: "",
    authorImage: null,
    agent: null,
    mentions: [],
    resolved: false,
    resolvedAt: null,
    createdAt: 0,
    editedAt: null,
    version: 0,
    mine: false,
    replies: [],
    attachments: [],
    people: [],
  }
}

export const entryDelivery = (entry: CommentsOutboxEntry): CommentDelivery => ({
  status: entry.status === "failed" ? "failed" : "pending",
  requestId: entry.requestId,
  files: entry.files,
  ...(entry.error ? { error: entry.error } : {}),
})

interface OutboxView {
  drop: string
  author: (account: string) => { name?: string | null; image?: string | null } | undefined
  /** The comments and replies the server took in this tab, by `requestId`, with the thread each is in. */
  accepted: ReadonlyMap<string, string>
  /** The id the server gives each waiting reply (replyMessageId), by replyKey, once the browser has worked it out. */
  replyIds?: ReadonlyMap<string, string>
  /** Where the browser shows a waiting image (fileUrls), by its key (fileKey), until the server has its own copy. */
  fileUrl?: (key: string, file: Blob) => string
}

/** The key of a waiting image among a message's attachments: no drop has it yet, so attachmentUrl asks the browser. */
export const LOCAL_ATTACHMENT = "local:"

/**
 * A waiting comment's or reply's images, as the server will list them, shown from the browser's copy. A site comment's
 * first file is the screenshot of its box, named so the row shows it as the server's copy would.
 */
function localAttachments(entry: CommentsOutboxEntry, view: OutboxView, screenshotFirst = false): CommentAttachment[] {
  const { fileUrl } = view
  if (!fileUrl) return []
  return entry.files.map((file, index) => ({
    id: `${LOCAL_ATTACHMENT}${fileKey(entry, index)}`,
    filename:
      file instanceof File && file.name ? file.name : screenshotFirst && index === 0 ? "screenshot.png" : "image",
    contentType: file.type,
    size: file.size,
    url: fileUrl(fileKey(entry, index), file),
  }))
}

/** A waiting image's key: its entry and place, which stay while the entry waits. */
const fileKey = (entry: CommentsOutboxEntry, index: number) => `${entry.id}:${index}`

/** Every waiting image's key, for fileUrls().keep. */
export const fileKeys = (entries: readonly CommentsOutboxEntry[]) =>
  entries.flatMap((entry) => entry.files.map((_, index) => fileKey(entry, index)))

/**
 * Object URLs for the outbox's images, one per image however often the list is computed. They're keyed by entry and
 * place, not by Blob: the outbox reads its entries again from IndexedDB after each try, which gives new Blobs of the
 * same image, and a new URL each time would revoke the one the thread shows. `keep` revokes the ones whose entry left
 * the outbox (landed or discarded), `clear` all of them, when the page goes.
 */
export function fileUrls() {
  const urls = new Map<string, string>()
  const keep = (keys: Iterable<string>) => {
    const kept = new Set(keys)
    for (const [key, url] of urls)
      if (!kept.has(key)) {
        URL.revokeObjectURL(url)
        urls.delete(key)
      }
  }
  return {
    urlOf(key: string, file: Blob) {
      let url = urls.get(key)
      if (!url) urls.set(key, (url = URL.createObjectURL(file)))
      return url
    },
    keep,
    clear: () => keep([]),
  }
}

/** A waiting reply's key in OutboxView.replyIds: the server's thread and the reply's retry key. */
export const replyKey = (threadId: string, requestId: string) => `${threadId}\n${requestId}`

/**
 * The drop's waiting entries, what the server already has by `requestId`, and the server's thread of each waiting
 * reply: a reply names its comment by the local id while the comment waits, and by the server's once it took it.
 */
function outboxOf(server: readonly DropComment[], entries: readonly CommentsOutboxEntry[], view: OutboxView) {
  const mine = entries.filter((entry) => dropOf(entry) === view.drop)
  const landed = new Map(view.accepted)
  for (const comment of server) {
    if (comment.requestId) landed.set(comment.requestId, comment.id)
    for (const reply of comment.replies) if (reply.requestId) landed.set(reply.requestId, comment.id)
  }
  const creates = new Map(mine.flatMap((entry) => (entry.kind === "create" ? [[entry.id, entry] as const] : [])))
  const parentOf = (threadId: string) => {
    const parent = creates.get(threadId)
    return parent ? (landed.get(parent.requestId) ?? parent.id) : threadId
  }
  return { mine, landed, creates, parentOf }
}

/**
 * The waiting replies whose server copy may already be in the list, as [thread, requestId]: the viewer works out each
 * one's message id (replyMessageId, which hashes) and hands them back to withOutbox as `replyIds`.
 */
export function waitingReplies(
  server: readonly DropComment[],
  entries: readonly CommentsOutboxEntry[],
  view: OutboxView,
) {
  const { mine, landed, parentOf } = outboxOf(server, entries, view)
  return mine.flatMap((entry) =>
    entry.kind === "reply" && !landed.has(entry.requestId)
      ? [[parentOf(entry.input.threadId), entry.requestId] as const]
      : [],
  )
}

/**
 * The drop's comments with what still waits in the outbox: waiting comments last, oldest first, each reply under its
 * comment. One the server already has shows once, as the server's: a comment by its `requestId`, a reply by its
 * `requestId` or by the message id the server derives from it (replyMessageId), which a list from before its answer
 * came back already holds.
 */
export function withOutbox(server: DropComment[], entries: readonly CommentsOutboxEntry[], view: OutboxView) {
  const { mine, landed, creates, parentOf } = outboxOf(server, entries, view)
  if (!mine.length) return server
  const stored = new Set(server.flatMap((comment) => comment.replies.map((reply) => reply.id)))
  const replies = new Map<string, CommentReply[]>()
  for (const entry of mine) {
    if (entry.kind !== "reply" || landed.has(entry.requestId)) continue
    const parent = parentOf(entry.input.threadId)
    const id = view.replyIds?.get(replyKey(parent, entry.requestId))
    if (id && stored.has(id)) continue
    replies.set(parent, [...(replies.get(parent) ?? []), pendingReply(entry, view)])
  }
  const withReplies = (comment: DropComment) => {
    const waiting = replies.get(comment.id)
    return waiting ? { ...comment, replies: [...comment.replies, ...waiting] } : comment
  }
  const pending = [...creates.values()].flatMap((entry) => {
    const target = entry.kind === "create" ? targetOf(entry.input.metadata) : undefined
    if (!target || landed.has(entry.requestId)) return []
    return [withReplies(pendingComment(entry, target, view))]
  })
  return [...server.map(withReplies), ...pending]
}

function pendingReply(entry: CommentsOutboxEntry, view: OutboxView): CommentReply {
  const author = view.author(entry.account)
  return {
    id: entry.id,
    body: entry.input.body,
    authorId: entry.account,
    authorName: author?.name ?? "Guest",
    authorImage: author?.image ?? null,
    agent: null,
    mentions: entry.input.mentions ?? [],
    createdAt: entry.createdAt,
    editedAt: null,
    mine: true,
    attachments: localAttachments(entry, view),
    requestId: entry.requestId,
    delivery: entryDelivery(entry),
  }
}

function pendingComment(entry: CommentsOutboxEntry, target: Target, view: OutboxView): DropComment {
  const base = { ...emptyComment(entry.id), version: target.version, createdAt: entry.createdAt }
  const author = view.author(entry.account)
  const words = {
    body: entry.input.body,
    authorId: entry.account,
    authorName: author?.name ?? "Guest",
    authorImage: author?.image ?? null,
    mentions: entry.input.mentions ?? [],
    mine: true,
    attachments: localAttachments(entry, view, target.route === "review"),
    requestId: entry.requestId,
    delivery: entryDelivery(entry),
  }
  if (target.route === "review") {
    const { page, ox, oy, ow, oh } = target.place
    return { ...base, ...words, kind: "area", ox, oy, ow, oh, page }
  }
  const { place } = target
  return {
    ...base,
    ...words,
    kind: place.kind,
    selector: place.selector,
    ox: place.ox,
    oy: place.oy,
    ow: place.ow,
    oh: place.oh,
    quote: place.quote ?? null,
    suggestion: place.suggestion ?? null,
    at: place.at ?? null,
    pdfPage: place.pdfPage ?? null,
    ink: place.ink ?? null,
    label: place.label ?? null,
    page: place.page ?? null,
  }
}

/**
 * A version 4 UUID for a retry key. `crypto.randomUUID()` exists only on HTTPS and localhost, and Drop on a LAN address
 * in development has neither.
 */
export function randomId() {
  if (globalThis.isSecureContext) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
