import type { CommentDelivery } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"

// What a comment or reply that hasn't reached the server says under its words. The outbox decides what happens to it
// (comment-outbox.ts and ViteHub's outbox): a network error, a 5xx, a 408 or a 429 waits and goes again, a 401 or a 402
// waits for the reader, and any other refusal stops until the reader edits, retries or discards it.

/** How long a comment waits quietly before it says so: a send on a working network lands well before. */
export const WAITING_NOTICE_MS = 2000

/**
 * What a pin or a row says in place of a comment's number while it's in the outbox. The frame's pins say the same
 * (`waitingText` in shared/plan-runtime.ts).
 */
export const waitingLabel = (delivery: CommentDelivery) =>
  delivery.status === "failed" ? "Not sent" : "Waiting to send"

type DeliveryAction = "sign-in" | "retry" | "copy" | "edit" | "discard"

interface DeliveryLine {
  /** `waiting` is muted; the others ask the reader for something. */
  state: "waiting" | "sign-in" | "plan" | "gone" | "refused"
  text: string
  actions: readonly DeliveryAction[]
}

/**
 * The line under a waiting or refused message, or none while it's young and only on its way. `since` is when it was
 * written, `now` the clock, so a comment sent on a working network never flashes "Waiting to send".
 */
export function deliveryLine(delivery: CommentDelivery, since: number, now: number): DeliveryLine | undefined {
  const status = delivery.error?.status ?? 0
  const why = delivery.error?.why
  if (delivery.status === "failed") {
    if (status === 403 || status === 404)
      return { state: "gone", text: "This drop no longer takes comments", actions: ["copy", "discard"] }
    return {
      state: "refused",
      text: why || "The server didn't take this comment",
      actions: ["edit", "discard"],
    }
  }
  // Held for the reader: it goes out once they sign in again, or once the plan has room.
  if (status === 401) return { state: "sign-in", text: "Sign in to send", actions: ["sign-in", "discard"] }
  if (status === 402) return { state: "plan", text: why || "Plan limit reached", actions: ["retry"] }
  if (now - since < WAITING_NOTICE_MS) return undefined
  return { state: "waiting", text: "Waiting to send", actions: [] }
}

/**
 * The dock's "N waiting": the drop's comments and replies that still wait to go out, past the quiet start. Refused ones
 * aren't waiting; each says so under its words.
 */
export function waitingCount(comments: readonly DropComment[], now: number) {
  let count = 0
  for (const item of comments.flatMap((comment) => [comment, ...comment.replies]))
    if (item.delivery?.status === "pending" && now - item.createdAt >= WAITING_NOTICE_MS) count++
  return count
}
