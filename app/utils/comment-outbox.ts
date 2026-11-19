import type { CommentDelivery, CommentsOutboxEntry, CommentsTransport, CommentThread } from "vite-hub/comments/client"
import type { CommentInput } from "#shared/schemas"
import type { CommentReply, DropComment } from "#shared/types"

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

function targetOf(metadata: Record<string, unknown> | undefined): Target | undefined {
  if (!metadata || typeof metadata.drop !== "string" || typeof metadata.place !== "string") return undefined
  const version = typeof metadata.version === "number" ? metadata.version : 0
  // SAFETY: `place` is the JSON targetMetadata wrote from a CommentPlace or a SiteCommentPlace, by `route`.
  const place = JSON.parse(metadata.place) as CommentPlace & SiteCommentPlace
  if (metadata.route === "review" && typeof metadata.origin === "string")
    return { route: "review", drop: metadata.drop, version, origin: metadata.origin, place }
  return {
    route: "comment",
    drop: metadata.drop,
    version,
    ...(typeof metadata.v === "number" ? { v: metadata.v } : {}),
    place,
  }
}

/** The drop a waiting entry's list is on. */
const dropOf = (entry: CommentsOutboxEntry) =>
  entry.kind === "create" ? targetOf(entry.input.metadata)?.drop : entry.subject?.id

/** A comment's or reply's body: JSON, or multipart with the JSON in `data` when it carries images. */
function withImages(data: Record<string, unknown>, files: readonly Blob[]) {
  if (!files.length) return data
  const form = new FormData()
  form.append("data", JSON.stringify(data))
  for (const file of files) form.append("image", file, file instanceof File && file.name ? file.name : "image")
  return form
}

/** What the outbox reads from a refusal: the status (none when there was no answer), the server's sentence, and its wait. */
function refusal(error: unknown) {
  const field = (name: string): unknown => (error && typeof error === "object" ? Reflect.get(error, name) : undefined)
  const response = field("response")
  const answered = response instanceof Response ? response : undefined
  const status = field("status") ?? field("statusCode") ?? answered?.status
  const seconds = Number(answered?.headers.get("retry-after") ?? Number.NaN)
  return Object.assign(new Error(errorText(error, "Couldn't send it. It waits and tries again.")), {
    ...(typeof status === "number" && status > 0 ? { status } : {}),
    ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfter: seconds * 1000 } : {}),
    cause: error,
  })
}

interface DropTransportHost {
  fetch: typeof $fetch
  /** The server took a comment: `comment` when the route answered it, else the drop whose list to load again. */
  created: (requestId: string, drop: string, comment: DropComment | null) => void | Promise<void>
  replied: (requestId: string, drop: string | undefined, threadId: string, reply: CommentReply) => void
  /** A refusal the plan-limit dialog explains, or another the reader should hear of. */
  refused: (error: unknown) => void
  /** The comment as a thread, for the outbox's receipt. */
  thread: (comment: DropComment) => CommentThread
}

const unused = () => Promise.reject(new Error("Drop's outbox only sends new comments and replies."))

/**
 * The outbox's transport: Drop's own routes, which keep the anchor, the screenshot and the suggestion, check sharing and
 * guests, and take the images with the comment. Only `create` and `reply` go through the outbox; the rest stay in useDrop.
 */
export function dropTransport(host: DropTransportHost): CommentsTransport {
  const send = async <T>(request: () => Promise<T>) => {
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
        form.append("data", JSON.stringify({ ...target.place, body: input.body, requestId }))
        if (screenshot) form.append("screenshot", screenshot, "screenshot")
        for (const file of images) form.append("image", file, file instanceof File && file.name ? file.name : "image")
        const { n } = await send(() =>
          host.fetch<{ n: number }>(`/api/drops/${target.drop}/review`, {
            method: "POST",
            query: { origin: target.origin },
            body: form,
          }),
        )
        await host.created(requestId, target.drop, null)
        // The route answers the number only; the list loads the rest.
        return {
          id: `review:${requestId}`,
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
          body: withImages({ ...target.place, body: input.body, mentions: input.mentions ?? [], requestId }, files),
        }),
      )
      const landed = { ...comment, requestId }
      await host.created(requestId, target.drop, landed)
      // The subject stays the outbox's, which names the drop whose list the comment and its waiting replies are on.
      return { ...host.thread(landed), subject: input.subject, requestId }
    },
    async reply(input) {
      const requestId = input.requestId ?? ""
      const reply = await send(() =>
        host.fetch<CommentReply>(`/api/comments/${input.threadId}/replies`, {
          method: "POST",
          body: withImages({ body: input.body, mentions: input.mentions ?? [], requestId }, input.files ?? []),
        }),
      )
      host.replied(requestId, input.subject?.id, input.threadId, { ...reply, requestId })
      return host.thread({ ...emptyComment(input.threadId), replies: [{ ...reply, requestId }] })
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

const delivery = (entry: CommentsOutboxEntry): CommentDelivery => ({
  status: entry.status === "failed" ? "failed" : "pending",
  requestId: entry.requestId,
  files: entry.files,
  ...(entry.error ? { error: entry.error } : {}),
})

interface OutboxView {
  drop: string
  account: string
  author: { name: string; image: string | null }
  /** The comments and replies the server took in this tab, by `requestId`, with the thread each is in. */
  accepted: ReadonlyMap<string, string>
}

/**
 * The drop's comments with what still waits in the outbox: waiting comments last, oldest first, each reply under its
 * comment. One the server already has, by its `requestId`, shows once, as the server's.
 */
export function withOutbox(server: DropComment[], entries: readonly CommentsOutboxEntry[], view: OutboxView) {
  const mine = entries.filter((entry) => dropOf(entry) === view.drop)
  if (!mine.length) return server
  const landed = new Map(view.accepted)
  for (const comment of server) {
    if (comment.requestId) landed.set(comment.requestId, comment.id)
    for (const reply of comment.replies) if (reply.requestId) landed.set(reply.requestId, comment.id)
  }
  const creates = new Map(mine.flatMap((entry) => (entry.kind === "create" ? [[entry.id, entry] as const] : [])))
  // A reply names its comment by the local id while the comment waits; once the server took it, by the server's.
  const parentOf = (threadId: string) => {
    const parent = creates.get(threadId)
    return parent ? (landed.get(parent.requestId) ?? parent.id) : threadId
  }
  const replies = new Map<string, CommentReply[]>()
  for (const entry of mine) {
    if (entry.kind !== "reply" || landed.has(entry.requestId)) continue
    const parent = parentOf(entry.input.threadId)
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
  return {
    id: entry.id,
    body: entry.input.body,
    authorId: view.account,
    authorName: view.author.name,
    authorImage: view.author.image,
    agent: null,
    mentions: entry.input.mentions ?? [],
    createdAt: entry.createdAt,
    editedAt: null,
    mine: true,
    attachments: [],
    requestId: entry.requestId,
    delivery: delivery(entry),
  }
}

function pendingComment(entry: CommentsOutboxEntry, target: Target, view: OutboxView): DropComment {
  const base = { ...emptyComment(entry.id), version: target.version, createdAt: entry.createdAt }
  const words = {
    body: entry.input.body,
    authorId: view.account,
    authorName: view.author.name,
    authorImage: view.author.image,
    mentions: entry.input.mentions ?? [],
    mine: true,
    requestId: entry.requestId,
    delivery: delivery(entry),
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
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let guestFallback: string | undefined
/**
 * Whose outbox this browser sends: the signed-in person's, or a guest's, one id per device. Kept in localStorage, so
 * a guest's waiting comments survive a reload; a window that blocks storage gets one id per page.
 */
export function outboxAccount(userId: string | undefined) {
  if (userId) return userId
  const key = "drop-guest-device"
  try {
    const saved = localStorage.getItem(key)
    if (saved) return `guest:${saved}`
    const id = randomId()
    localStorage.setItem(key, id)
    return `guest:${id}`
  } catch {
    return `guest:${(guestFallback ??= randomId())}`
  }
}
