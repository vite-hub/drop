import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import { H3Event } from "h3"
import type { CommentSendPromptContext, CommentSubject, CommentsUser, CommentUser } from "vite-hub/comments"
import { defineComments, defineCommentSubject } from "vite-hub/comments"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { user as users } from "./databases/default/index"
import { pageImageType, storeCommentFile, storePageImage } from "./utils/comment-images"
import { findDrop, permissions } from "./utils/drops"
import { handoffData, isSendRoute, publishingThread, sendSubject } from "./utils/handoffs"
import { type Identity, identify, identityOf } from "./utils/identity"

type DropCommentsUser = CommentsUser & { identity?: Identity }

const identityIn = (user: DropCommentsUser | null): Identity | null => (user?.guest ? null : (user?.identity ?? null))
const sendPermissions = new WeakMap<Identity, Map<string, ReturnType<typeof allowed>>>()

export function sendUser(who: Identity): DropCommentsUser {
  const identity = { ...who }
  sendPermissions.set(identity, new Map())
  return { id: who.userId, name: who.name, ...(who.image ? { image: who.image } : {}), identity }
}

function sendPrompt({ origin, pairUrl, code, prompt }: CommentSendPromptContext) {
  const pair = (inbox: string) =>
    `curl -sS -X POST ${pairUrl} -H 'content-type: application/json' -d '${JSON.stringify({ code, inbox })}'`
  const [, ...t3ThreadSteps] = prompt.split("\n\n")
  return [
    `Connect my Drop comments from ${new URL(origin).host} to this agent. Use exactly one of the following setup options.`,
    `For Claude Code, run: ${pair("Claude Code")}`,
    `For Codex, run: ${pair("Codex")}`,
    "After I allow an inbox on the site, use Drop's list_handoffs tool to find sends and read_drop with the handoff id to read one. Do not create a webhook for inbox setup.",
    "For a T3 Code thread with the T3 tools available, use the webhook option instead:",
    ...t3ThreadSteps,
  ].join("\n\n")
}

const dropLink = (kind: string) =>
  defineCommentSubject({
    kind,
    scope: (id) => `${kind}:${id}`,
    emptyBody: ({ metadata }) => (metadata?.suggestion ?? null) !== null,
    link: (thread) => `/drops/${thread.subject.id}?comment=${thread.n}`,
  })

async function allowed(subject: CommentSubject | undefined, who: Identity | null) {
  if (!subject || (subject.kind !== "drop" && subject.kind !== "site")) {
    const admin = who?.role === "admin"
    return { view: admin, comment: admin, manage: admin }
  }
  const drop = await findDrop(subject.id)
  return drop ? permissions(drop, who) : { view: false, comment: false, manage: false }
}

const person = (row: { id: string; name: string; image: string | null }): CommentUser => ({
  id: row.id,
  name: row.name,
  ...(row.image ? { image: row.image } : {}),
})

const notBanned = or(eq(users.banned, false), isNull(users.banned))

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

function rank(name: string, needle: string) {
  if (name.startsWith(needle)) return 0
  if (name.split(/\s+/u).some((word) => word.startsWith(needle))) return 1
  return name.includes(needle) ? 2 : -1
}

export async function peopleByIds(ids: readonly string[]): Promise<CommentUser[]> {
  if (!ids.length) return []
  const rows = await db
    .select({ id: users.id, name: users.name, image: users.image })
    .from(users)
    .where(and(notBanned, inArray(users.id, [...ids])))
  return rows.map(person)
}

export default defineComments({
  subjects: [dropLink("drop"), dropLink("site")],

  send: {
    grant: false,
    payload: ({ subject, user }) => handoffData(subject, user.id),
    address: ({ subject, user }) => publishingThread(subject, user.id),
    prompt: sendPrompt,
  },

  page: ({ url, event }) =>
    sendSubject(url.pathname, new URL((event instanceof H3Event ? event.req : event["~standard"].req).url).pathname),

  async identify({ event }) {
    const request = event instanceof H3Event ? event : new H3Event(event["~standard"].req, event.context)
    const who = await identify(request)
    if (!who) return null
    const email = isSendRoute(request.url.pathname)
      ? { email: who.email, emailVerified: who.emailVerified === true }
      : {}
    const identity = { ...who }
    if (isSendRoute(request.url.pathname)) sendPermissions.set(identity, new Map())
    return { id: who.userId, name: who.name, ...(who.image ? { image: who.image } : {}), ...email, identity }
  },

  async authorize({ user, action, thread, subject, console: admitted }) {
    const on = subject ?? thread?.subject
    if (admitted === true && on?.kind !== "drop" && on?.kind !== "site") return true
    const who = identityIn(user)
    const memo = who && sendPermissions.get(who)
    if (memo && on?.kind !== "drop" && on?.kind !== "site") return false
    const key = on ? `${on.kind}:${on.id}` : ""
    const policy = memo?.get(key) ?? allowed(on, who)
    memo?.set(key, policy)
    const can = await policy
    if (action === "read") return can.view
    if (action === "write") return can.comment
    if (action === "resolve") return can.manage || Boolean(who && thread?.author.id === who.userId)
    return can.manage
  },

  people: {
    async search(query, limit) {
      const everyone = db
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(notBanned)
        .orderBy(asc(users.name), asc(users.id))
      const needle = fold(query.slice(0, 40)).trim()
      if (!needle) return (await everyone.limit(limit)).map(person)
      return (await everyone)
        .map((row) => ({ row, tier: rank(fold(row.name), needle) }))
        .filter(({ tier }) => tier >= 0)
        .sort((a, b) => a.tier - b.tier)
        .slice(0, limit)
        .map(({ row }) => person(row))
    },
    byIds: peopleByIds,
  },

  async canMention({ user, person: mentioned, subject, thread }) {
    if (!user || user.guest) return false
    const who = await identityOf(mentioned.id)
    return Boolean(who && (await allowed(subject ?? thread?.subject, who)).view)
  },

  onMention() {},

  async storeAttachment(file, { user, subject }) {
    const who = identityIn(user)
    if (subject?.kind === "page" && (await allowed(subject, who)).comment) return storePageImage(file)
    return storeCommentFile(file, subject, who)
  },

  async readAttachment(key) {
    const pageType = pageImageType(key)
    if (pageType) {
      const [error, file] = await blob.get(key)
      return error || !file ? null : new Blob([file], { type: pageType })
    }
    const row = await findDrop(key)
    if (!row?.blobKey || row.kind !== "image") return null
    const [error, file] = await blob.get(row.blobKey)
    if (error || !file) return null
    return new Blob([file], { type: row.contentType ?? "application/octet-stream" })
  },
})
