import { and, asc, eq, inArray, isNull, like, or } from "drizzle-orm"
import type { CommentSubject, CommentsUser, CommentUser } from "vite-hub/comments"
import { defineComments, defineCommentSubject } from "vite-hub/comments"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { user as users } from "./databases/config"
import { storeCommentFile } from "./utils/comment-images"
import { findDrop, permissions } from "./utils/drops"
import { type Identity, identify, identityOf } from "./utils/identity"

/**
 * Comments on drops, and the team's comments on Drop's own pages, Figma style, in one ViteHub Comments model.
 *
 * - `drop` threads are about a doc, an image, an app, or a board: scope `drop:<id>`, numbered across its versions, with
 *   `revision` = the version they were written on.
 * - `site` threads are about a site under review and the screenshots sent from it: scope `site:<id>`. A screenshot's
 *   thread keeps the screenshot's id in `metadata.dropId`.
 * - `page` threads are the Console's toolbar on Drop's own pages, for Drop admins.
 *
 * Drop's own routes check who may with `permissions` and review tokens (server/utils/comments.ts) and call the server
 * API. `authorize` answers the same for ViteHub's surfaces: the Comments API the viewer asks for "@" people and comment
 * images, the toolbar, the Console, and ViteHub MCP.
 */

/** Drop's identity rides on the Comments user, so `authorize` and `canMention` read Drop's permissions. */
type DropCommentsUser = CommentsUser & { identity?: Identity }

function identityIn(user: CommentsUser | null): Identity | null {
  // SAFETY: `identify` below builds every Comments user of a request, and puts Drop's identity on it.
  return user ? ((user as DropCommentsUser).identity ?? null) : null
}

const dropLink = (kind: string) =>
  defineCommentSubject({
    kind,
    scope: (id) => `${kind}:${id}`,
    // A suggestion keeps its words in `metadata.suggestion`, so its note may be empty.
    emptyBody: ({ metadata }) => (metadata?.suggestion ?? null) !== null,
    link: (thread) => `/drops/${thread.subject.id}?comment=${thread.n}`,
  })

/** What a drop or site thread lets `who` do, from the drop's sharing. Page threads are the admins'. */
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

/** People by id, as `@` names them: the ones a comment's mentions point at, so readers see their names. */
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

  async identify({ event }) {
    const who = await identify(event)
    if (!who) return null
    return { id: who.userId, name: who.name, ...(who.image ? { image: who.image } : {}), identity: who }
  },

  async authorize({ user, action, thread, subject }) {
    const who = identityIn(user)
    const can = await allowed(subject ?? thread?.subject, who)
    if (action === "read") return can.view
    if (action === "write") return can.comment
    // As in Drop: its author or the drop's managers resolve a thread, and only managers delete other people's words.
    if (action === "resolve") return can.manage || Boolean(who && thread?.author.id === who.userId)
    return can.manage
  },

  // Everyone in this Drop, by name. `canMention` then keeps the ones who may read the thread.
  people: {
    async search(query, limit) {
      const rows = await db
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(and(notBanned, query ? like(users.name, `%${query.slice(0, 40)}%`) : undefined))
        .orderBy(asc(users.name), asc(users.id))
        .limit(limit)
      return rows.map(person)
    },
    byIds: peopleByIds,
  },

  /**
   * An `@` names someone who can read what the thread is on, so the link in it opens for them. Guests name nobody:
   * a stranger on a public link would otherwise list everyone who can read it.
   */
  async canMention({ user, person: mentioned, subject, thread }) {
    if (!user || user.guest) return false
    const who = await identityOf(mentioned.id)
    return Boolean(who && (await allowed(subject ?? thread?.subject, who)).view)
  },

  // The hook for telling people they were mentioned. Drop sends no email yet; the viewer marks the mention.
  onMention() {},

  /** A file from ViteHub's surfaces: an image drop under the commented drop, like the images Drop's own routes take. */
  storeAttachment: (file, { user, subject }) => storeCommentFile(file, subject, identityIn(user)),

  /**
   * A comment image by its key, the image drop's id. ViteHub serves it at /api/_vitehub/comments/attachments/<id> once
   * it found a thread that lists the key and the reader may read.
   */
  async readAttachment(key) {
    const row = await findDrop(key)
    if (!row?.blobKey || row.kind !== "image") return null
    const [error, file] = await blob.get(row.blobKey)
    if (error || !file) return null
    return new Blob([file], { type: row.contentType ?? "application/octet-stream" })
  },
})
