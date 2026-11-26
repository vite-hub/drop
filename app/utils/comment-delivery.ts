import type { CommentDelivery, CommentDeliveryError, CommentsOutboxEntry } from "vite-hub/comments/client"
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

export const STUCK_SENDING_MS = 5000

/** An outbox entry, or the delivery of a comment on the page, which lacks `sending` and `held`. */
interface Delivery {
  status: CommentsOutboxEntry["status"]
  requestId: string
  error?: CommentDeliveryError
  held?: boolean
}

export interface DeliveryClock {
  now: number
  online: boolean
  /** When the outbox started sending this request, while it is sending. */
  sendingSince: (requestId: string) => number | undefined
}

/**
 * Comments on their way show as pending pins, so a count shows only trouble: refused, held, retrying after an error,
 * waiting for the network, or a queue head that has been going out for more than 5 s.
 */
export function inTrouble(delivery: Delivery, clock: DeliveryClock) {
  if (delivery.status === "failed" || delivery.held || delivery.error || !clock.online) return true
  const since = clock.sendingSince(delivery.requestId)
  return since !== undefined && clock.now - since > STUCK_SENDING_MS
}

export const troubleCount = (deliveries: readonly Delivery[], clock: DeliveryClock) =>
  deliveries.filter((delivery) => inTrouble(delivery, clock)).length

export const waitingCount = (comments: readonly DropComment[], clock: DeliveryClock) =>
  troubleCount(
    comments.flatMap((comment) => [comment, ...comment.replies]).flatMap((item) => item.delivery ?? []),
    clock,
  )
