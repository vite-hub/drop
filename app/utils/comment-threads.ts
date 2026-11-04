import type { CommentMessage, CommentSubject, CommentThread, CommentUser } from "vite-hub/comments/client"
import type { CommentAttachment, CommentReply, DropComment, DropDetail } from "#shared/types"

// Drop's comments as ViteHub's comment model, for the comment parts of vite-hub/ui. Drop's routes answer DropComment,
// which review.js and the agents read too, so the viewer reads the same and shows it as threads.

const person = (id: string, name: string, image: string | null): CommentUser => ({
  id,
  name,
  ...(image ? { image } : {}),
  ...(id.startsWith("guest:") ? { guest: true } : {}),
})

/**
 * What a drop's comments are about, as server/utils/comments.ts `commentList` says: a site with its screenshots, or the
 * drop itself across its versions.
 */
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
    mentions: item.mentions,
    // Each image is a drop of its own, and its id is the key the message keeps.
    attachments: item.attachments.map((file) => file.id),
    createdAt: item.createdAt,
    ...(item.editedAt ? { editedAt: item.editedAt } : {}),
  }
}

/**
 * A comment and its replies as one thread. Its anchor is the whole page: Drop draws its own pins inside the drop's
 * frame, where the parts can't measure them (a text anchor there reads "Detached"), and the thread's `#anchor` slot
 * shows the quote or the suggestion.
 */
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
    author: person(comment.authorId, comment.authorName, comment.authorImage),
    messages,
    revision: comment.version,
    createdAt: comment.createdAt,
    updatedAt: Math.max(...messages.map((item) => item.editedAt ?? item.createdAt)),
  }
}

/** The comments' images by their key, for the name and type the parts show. */
export function attachmentsOf(comments: DropComment[]) {
  const files = new Map<string, CommentAttachment>()
  for (const comment of comments)
    for (const file of [...comment.attachments, ...comment.replies.flatMap((reply) => reply.attachments)])
      files.set(file.id, file)
  return files
}
