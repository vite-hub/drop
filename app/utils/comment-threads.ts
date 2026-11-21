import type { CommentActor, CommentMessage, CommentSubject, CommentThread, CommentUser } from "vite-hub/comments/client"
import type { CommentAgent, CommentAttachment, CommentReply, DropComment, DropDetail } from "#shared/types"

const person = (id: string, name: string, image: string | null): CommentUser => ({
  id,
  name,
  ...(image ? { image } : {}),
  ...(id === "guest" || id.startsWith("guest:") ? { guest: true } : {}),
})

const actor = (agent: CommentAgent): CommentActor => ({
  id: agent.name,
  name: agent.name,
  ...(agent.image ? { image: agent.image } : {}),
})

export function commentSubject(drop: Pick<DropDetail, "id" | "kind" | "ancestors"> | null | undefined): CommentSubject {
  if (!drop) return { kind: "drop", id: "" }
  if (drop.kind === "site") return { kind: "site", id: drop.id }
  const parent = drop.ancestors.at(-1)
  return drop.kind === "image" && parent?.kind === "site"
    ? { kind: "site", id: parent.id }
    : { kind: "drop", id: drop.id }
}

function message(thread: DropComment, item: DropComment | CommentReply, id: string): CommentMessage {
  return {
    id,
    threadId: thread.id,
    body: item.body,
    author: person(item.authorId, item.authorName, item.authorImage),
    ...(item.agent ? { actor: actor(item.agent) } : {}),
    mentions: item.mentions,
    attachments: item.attachments.map((file) => file.id),
    createdAt: item.createdAt,
    ...(item.editedAt ? { editedAt: item.editedAt } : {}),
    ...(item.delivery ? { delivery: item.delivery } : {}),
  }
}

export function toThread(comment: DropComment, subject: CommentSubject): CommentThread {
  const messages = [
    message(comment, comment, comment.messageId),
    ...comment.replies.map((reply) => message(comment, reply, reply.id)),
  ]
  return {
    id: comment.id,
    scope: `${subject.kind}:${subject.id}`,
    n: comment.n,
    subject,
    anchor: { kind: "page" },
    status: comment.resolved ? "resolved" : "open",
    ...(comment.resolved && comment.resolvedAt ? { resolvedAt: comment.resolvedAt } : {}),
    author: person(comment.authorId, comment.authorName, comment.authorImage),
    ...(comment.agent ? { actor: actor(comment.agent) } : {}),
    messages,
    revision: comment.version,
    createdAt: comment.createdAt,
    updatedAt: Math.max(...messages.map((item) => item.editedAt ?? item.createdAt)),
    ...(comment.requestId ? { requestId: comment.requestId } : {}),
    ...(comment.delivery ? { delivery: comment.delivery } : {}),
  }
}

export function needsLook({ resolved, resolvedAt, replies }: DropComment) {
  return !resolved || (resolvedAt !== null && replies.some((reply) => reply.createdAt > resolvedAt))
}

export function attachmentsOf(comments: DropComment[]) {
  const files = new Map<string, CommentAttachment>()
  for (const comment of comments)
    for (const file of [...comment.attachments, ...comment.replies.flatMap((reply) => reply.attachments)])
      files.set(file.id, file)
  return files
}
