import { and, desc, eq, inArray, sql } from "drizzle-orm"
import * as v from "valibot"
import type { CommentSendData, CommentSubject, CommentThread } from "vite-hub/comments"
import { commentMessages, commentSends, commentThreads } from "vite-hub/comments/database"
import { db } from "vite-hub/database"
import { findDrop, permissions } from "./drops"
import type { DropRow } from "./drops/types"
import type { Identity } from "./identity"

const DROP_PAGE = /^\/d(?:rops)?\/([^/]+)/

export const isSendRoute = (route: string) => route.startsWith("/_vitehub/comments/send")

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

export async function publishingThread(subject: CommentSubject, sender: string): Promise<string | null> {
  const drop = subject.kind === "drop" || subject.kind === "site" ? await findDrop(subject.id) : null
  return drop ? (publishingSession(drop, sender)?.thread ?? null) : null
}

type SendRow = typeof commentSends.$inferSelect

type HandoffState = SendRow["state"]

interface HandoffThread {
  id: string
  role: "ask" | "quote"
}

export interface Handoff {
  id: string
  sender: string
  state: HandoffState
  drop: DropRow
  threads: HandoffThread[]
  createdAt: number
}

const SentThreads = v.array(v.object({ id: v.string(), role: v.fallback(v.picklist(["ask", "quote"]), "ask") }))

function threadsOf(row: SendRow): HandoffThread[] {
  const parsed = v.safeParse(SentThreads, JSON.parse(row.threads))
  return parsed.success ? parsed.output : []
}

async function dropOf(row: SendRow, who: Identity) {
  if (row.subjectKind !== "drop" && row.subjectKind !== "site") return null
  const drop = await findDrop(row.subjectId)
  return drop && permissions(drop, who).view ? drop : null
}

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

const LISTED = 20

function hasWaitingFeedback(reopenedId?: string) {
  return sql`exists (
      select 1 from json_each(${commentSends.threads}) as entry
      join ${commentThreads} on ${commentThreads.id} = json_extract(entry.value, '$.id')
      where ${commentThreads.status} = 'open'
        ${reopenedId ? sql`and ${commentThreads.id} = ${reopenedId}` : sql``}
        and (coalesce(json_extract(entry.value, '$.role'), 'ask') = 'ask' or not exists (
          select 1 from json_each(${commentSends.threads}) as candidate
          where coalesce(json_extract(candidate.value, '$.role'), 'ask') = 'ask'
        ))
        and (select nullif(${commentMessages.actor}, 'null') is null
          ${reopenedId ? sql`and ${commentMessages.id} = json_extract(entry.value, '$.message')` : sql``}
          from ${commentMessages}
          where ${commentMessages.threadId} = ${commentThreads.id}
          order by ${commentMessages.createdAt} desc, ${commentMessages.id} desc limit 1)
    )`
}

export async function restoreReopenedHandoffs({ id, subject }: CommentThread) {
  const restored = await db
    .update(commentSends)
    .set({ state: "sent", updatedAt: Date.now() })
    .where(
      and(
        eq(commentSends.subjectKind, subject.kind),
        eq(commentSends.subjectId, subject.id),
        eq(commentSends.state, "done"),
        hasWaitingFeedback(id),
      ),
    )
    .returning({ id: commentSends.id })
  return restored.length > 0
}

async function finishAnsweredHandoffs(member: string) {
  await db
    .update(commentSends)
    .set({ state: "done", updatedAt: Date.now() })
    .where(
      and(
        eq(commentSends.member, member),
        inArray(commentSends.state, ["sent", "working"]),
        sql`not ${hasWaitingFeedback()}`,
      ),
    )
}

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

export async function lastSentAt(member: string): Promise<number | null> {
  const [row] = await db
    .select({ createdAt: commentSends.createdAt })
    .from(commentSends)
    .where(and(eq(commentSends.member, member), inArray(commentSends.state, ["sent", "working", "done"])))
    .orderBy(desc(commentSends.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}
