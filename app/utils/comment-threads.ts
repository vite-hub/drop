import type { CommentMessage, CommentSubject, CommentThread, CommentUser } from "vite-hub/comments/client"
import type { CommentReply, DropComment } from "#shared/types"

// Drop's comments as ViteHub's comment model, for the comment parts of vite-hub/ui. Drop's routes answer DropComment,
// which review.js and the agents read too, so the viewer reads the same and shows it as threads.

const person = (id: string, name: string, image: string | null): CommentUser => ({
  id,
  name,
  ...(image ? { image } : {}),
  ...(id.startsWith("guest:") ? { guest: true } : {}),
})

const attachmentKey = (file: { id: string; filename: string }) => `${file.id}/${file.filename}`

/** What a drop's comments are about: the drop, or the site its screenshots came from. */
export const dropSubject = (id: string, site?: string | null): CommentSubject =>
  site ? { kind: "site", id: site } : { kind: "drop", id }

function message(thread: DropComment, item: DropComment | CommentReply, id: string): CommentMessage {
  return {
    id,
    threadId: thread.id,
    body: item.body,
    author: person(item.authorId, item.authorName, item.authorImage),
    mentions: item.mentions,
    // Each image is a drop of its own; `attachmentUrl` finds where Drop serves it. The name after the id is the one
    // the parts show.
    attachments: item.attachments.map(attachmentKey),
    createdAt: item.createdAt,
    ...(item.editedAt ? { editedAt: item.editedAt } : {}),
  }
}

/**
 * A comment and its replies as one thread. Its anchor is the whole page: Drop draws its own pins inside the drop's
 * frame, where the parts can't measure them, and the thread's `#anchor` slot shows the quote or the suggestion.
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

/** Where Drop serves each comment image, by its key in the thread. */
export function attachmentUrls(comments: DropComment[]) {
  const urls = new Map<string, string>()
  for (const comment of comments)
    for (const file of [...comment.attachments, ...comment.replies.flatMap((reply) => reply.attachments)])
      urls.set(attachmentKey(file), file.url)
  return urls
}
