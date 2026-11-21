import type { CommentDelivery } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"

export const WAITING_NOTICE_MS = 2000

export const waitingLabel = (delivery: CommentDelivery) =>
  delivery.status === "failed" ? "Not sent" : "Waiting to send"

type DeliveryAction = "sign-in" | "retry" | "copy" | "edit" | "discard"

interface DeliveryLine {
  state: "waiting" | "sign-in" | "plan" | "gone" | "refused"
  text: string
  actions: readonly DeliveryAction[]
}

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
  if (status === 401) return { state: "sign-in", text: "Sign in to send", actions: ["sign-in", "discard"] }
  if (status === 402) return { state: "plan", text: why || "Plan limit reached", actions: ["retry"] }
  if (now - since < WAITING_NOTICE_MS) return undefined
  return { state: "waiting", text: "Waiting to send", actions: [] }
}

export function waitingCount(comments: readonly DropComment[], now: number) {
  let count = 0
  for (const item of comments.flatMap((comment) => [comment, ...comment.replies]))
    if (item.delivery?.status === "pending" && now - item.createdAt >= WAITING_NOTICE_MS) count++
  return count
}
