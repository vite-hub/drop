import { and, desc, eq, inArray, sql } from "drizzle-orm"
import * as v from "valibot"
import type { CommentSendData, CommentSubject } from "vite-hub/comments"
import { commentMessages, commentSends, commentThreads } from "vite-hub/comments/database"
import { db } from "vite-hub/database"
import { findDrop, permissions } from "./drops"
import type { DropRow } from "./drops/types"
import type { Identity } from "./identity"

/**
 * Handoffs: what Send in the review pill hands a member's agent. ViteHub Comments keeps each send as one row of
 * `vitehub_comment_sends`, so that row is the handoff, and its id (`send_…`) is what `read_drop({ handoff })` takes.
 * A send is `sent` until the agent reads it, `working` after, `done` once every ask has an answer, and `failed` when
 * the delivery never arrived.
 */

/** A drop's page: `/d/<id>` with any slug or app path after it, or `/drops/<id>`. */
const DROP_PAGE = /^\/d(?:rops)?\/([^/]+)/

/** Whether a request is one of Send's routes, such as `POST /_vitehub/comments/send/allow`. */
export const isSendRoute = (route: string) => route.startsWith("/_vitehub/comments/send")

/**
 * The subject of a drop's page for Send, `drop:<id>` or `site:<id>` as its threads have. Nothing for any other page,
 * and nothing outside Send's routes: the ViteHub toolbar on a drop's page keeps its own `page` threads.
 */
export async function sendSubject(path: string, route: string): Promise<CommentSubject | null> {
  if (!isSendRoute(route)) return null
  const id = DROP_PAGE.exec(path)?.[1]
  const drop = id ? await findDrop(decodeURIComponent(id)) : null
  if (drop?.kind === "image" && drop.ancestors?.[0]?.kind === "site") return null
  return drop ? { kind: drop.kind === "site" ? "site" : "drop", id: drop.id } : null
}

export function publishingSession(drop: DropRow, sender: string) {
  return drop.ownerId === sender && (drop.sessionPublisherId ?? (drop.version === 1 ? drop.ownerId : null)) === sender
    ? (drop.agent?.session ?? null)
    : null
}

/**
 * The `data` of each delivery: the drop, the version to publish on as `base`, and the session that published it, so
 * an inbox can hand the send on to the thread that wrote the drop, but only when the sender owns the drop and published
 * its current version.
 */
export async function handoffData(subject: CommentSubject, sender: string): Promise<CommentSendData> {
  const drop = subject.kind === "drop" || subject.kind === "site" ? await findDrop(subject.id) : null
  if (!drop) return null
  const session = publishingSession(drop, sender)
  return {
    drop: drop.id,
    version: drop.version,
    base: drop.kind === "site" ? null : drop.version,
    session: session ? { ...session } : null,
  }
}

/**
 * Where Send reaches the drop's owner: the thread that published it. An owner who paired that T3 thread gets the send
 * there; otherwise it goes to the agent they paired last. Teammates send to their own last agent.
 */
export async function publishingThread(subject: CommentSubject, sender: string): Promise<string | null> {
  const drop = subject.kind === "drop" || subject.kind === "site" ? await findDrop(subject.id) : null
  return drop ? (publishingSession(drop, sender)?.thread ?? null) : null
}

type SendRow = typeof commentSends.$inferSelect

type HandoffState = SendRow["state"]

/** One thread a handoff carries: `ask` is the sender's own, or one they answered last; `quote` is someone else's. */
interface HandoffThread {
  id: string
  role: "ask" | "quote"
}

export interface Handoff {
  id: string
  /** The member who pressed Send, the only one who may read it. */
  sender: string
  state: HandoffState
  drop: DropRow
  threads: HandoffThread[]
  createdAt: number
}

/** The threads a send stored, as ViteHub writes them: `[{ id, message, role }]`. */
const SentThreads = v.array(v.object({ id: v.string(), role: v.fallback(v.picklist(["ask", "quote"]), "ask") }))

function threadsOf(row: SendRow): HandoffThread[] {
  const parsed = v.safeParse(SentThreads, JSON.parse(row.threads))
  return parsed.success ? parsed.output : []
}

/** The drop a send was made on, when the sender may still see it. */
async function dropOf(row: SendRow, who: Identity) {
  if (row.subjectKind !== "drop" && row.subjectKind !== "site") return null
  const drop = await findDrop(row.subjectId)
  return drop && permissions(drop, who).view ? drop : null
}

/**
 * Opens one of the caller's handoffs for their agent and marks it working, as ViteHub's read token does. Another
 * member's handoff, a failed one, or one on a drop the caller can't see any more is nobody's to open: `null`.
 */
export async function openHandoff(id: string, who: Identity): Promise<Handoff | null> {
  const [row] = await db.select().from(commentSends).where(eq(commentSends.id, id)).limit(1)
  if (!row || row.member !== who.userId || row.state === "failed") return null
  const drop = await dropOf(row, who)
  if (!drop) return null
  let { state } = row
  if (state === "sent") {
    await db
      .update(commentSends)
      .set({ state: "working", updatedAt: Date.now() })
      .where(and(eq(commentSends.id, row.id), eq(commentSends.state, "sent")))
    state = "working"
  }
  return { id: row.id, sender: row.member, state, drop, threads: threadsOf(row), createdAt: row.createdAt }
}

/** At most this many handoffs in a list. */
const LISTED = 20

async function finishAnsweredHandoffs(member: string) {
  await db
    .update(commentSends)
    .set({ state: "done", updatedAt: Date.now() })
    .where(
      and(
        eq(commentSends.member, member),
        inArray(commentSends.state, ["sent", "working"]),
        sql`not exists (
      select 1 from json_each(${commentSends.threads}) as entry
      join ${commentThreads} on ${commentThreads.id} = json_extract(entry.value, '$.id')
      where ${commentThreads.status} = 'open'
        and (coalesce(json_extract(entry.value, '$.role'), 'ask') = 'ask' or not exists (
          select 1 from json_each(${commentSends.threads}) as candidate
          where coalesce(json_extract(candidate.value, '$.role'), 'ask') = 'ask'
        ))
        and (select nullif(${commentMessages.actor}, 'null') is null from ${commentMessages}
          where ${commentMessages.threadId} = ${commentThreads.id}
          order by ${commentMessages.createdAt} desc, ${commentMessages.id} desc limit 1)
    )`,
      ),
    )
}

/** The caller's handoffs that no agent finished: `sent` ones wait for one, `working` ones have it. Newest first. */
export async function listHandoffs(who: Identity): Promise<Handoff[]> {
  await finishAnsweredHandoffs(who.userId)
  const rows = await db
    .select()
    .from(commentSends)
    .where(and(eq(commentSends.member, who.userId), inArray(commentSends.state, ["sent", "working"])))
    .orderBy(desc(commentSends.createdAt))
    .limit(LISTED)
  const listed = await Promise.all(
    rows.map(async (row) => {
      const drop = await dropOf(row, who)
      return drop
        ? [
            {
              id: row.id,
              sender: row.member,
              state: row.state,
              drop,
              threads: threadsOf(row),
              createdAt: row.createdAt,
            },
          ]
        : []
    }),
  )
  return listed.flat()
}

/** When the member's last send went, for the Agents page. */
export async function lastSentAt(member: string): Promise<number | null> {
  const [row] = await db
    .select({ createdAt: commentSends.createdAt })
    .from(commentSends)
    .where(and(eq(commentSends.member, member), inArray(commentSends.state, ["sent", "working", "done"])))
    .orderBy(desc(commentSends.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}
