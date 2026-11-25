import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { HTTPError } from "h3"
import type { CommentSendData, CommentSendView, CommentSubject, CommentThread } from "vite-hub/comments"
import { commentMessages, commentSends, commentThreads } from "vite-hub/comments/database"
import { db } from "vite-hub/database"
import comments, { sendUser } from "../comments"
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

type HandoffState = CommentSendView["send"]["state"]

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

async function handoffOf({ send, threads }: CommentSendView, who: Identity): Promise<Handoff | null> {
  if (send.subject.kind !== "drop" && send.subject.kind !== "site") return null
  const drop = await findDrop(send.subject.id)
  if (!drop || !permissions(drop, who).view) return null
  return {
    id: send.id,
    sender: who.userId,
    state: send.state,
    drop,
    threads: threads.map(({ id, role }) => ({ id, role })),
    createdAt: send.createdAt,
  }
}

function unavailable(error: Error & { code: string }) {
  return new HTTPError({ status: 503, statusText: "Comments are temporarily unavailable.", cause: error })
}

export async function openHandoff(id: string, who: Identity): Promise<Handoff | null> {
  const [error, opened] = await comments.readSend(sendUser(who), id)
  if (error?.code === "COMMENTS_NOT_FOUND") return null
  if (error) throw unavailable(error)
  return handoffOf(opened, who)
}

export async function waitsInFinishedHandoff({ id, subject }: CommentThread) {
  const [row] = await db
    .select({ id: commentSends.id })
    .from(commentSends)
    .where(
      and(
        eq(commentSends.subjectKind, subject.kind),
        eq(commentSends.subjectId, subject.id),
        eq(commentSends.state, "done"),
        sql`exists (
          select 1 from json_each(${commentSends.threads}) as entry
          join ${commentThreads} on ${commentThreads.id} = json_extract(entry.value, '$.id')
          where ${commentThreads.id} = ${id}
            and ${commentThreads.status} = 'open'
            and (coalesce(json_extract(entry.value, '$.role'), 'ask') = 'ask' or not exists (
              select 1 from json_each(${commentSends.threads}) as candidate
              where coalesce(json_extract(candidate.value, '$.role'), 'ask') = 'ask'
            ))
            and (select nullif(${commentMessages.actor}, 'null') is null
              and ${commentMessages.id} = json_extract(entry.value, '$.message')
              from ${commentMessages}
              where ${commentMessages.threadId} = ${commentThreads.id}
              order by ${commentMessages.createdAt} desc, ${commentMessages.id} desc limit 1)
        )`,
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listHandoffs(who: Identity): Promise<Handoff[]> {
  const [error, sends] = await comments.listSends(sendUser(who))
  if (error) throw unavailable(error)
  return (await Promise.all(sends.map((send) => handoffOf(send, who)))).filter((handoff) => handoff !== null)
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
