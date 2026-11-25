import type * as v from "valibot"
import type { CardReason } from "#shared/content-unavailable"
import type { ClientEventSchema, SIGN_IN_MODES } from "#shared/schemas"
import { ATTEMPT_COOKIE } from "#shared/sign-in"

export type ClientEvent = v.InferInput<typeof ClientEventSchema>

export function sendClientEvent(body: ClientEvent) {
  fetch("/api/client-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

export function reportClientEvent(body: ClientEvent) {
  if (import.meta.client) sendClientEvent(body)
}

export function reportSignInClicked(mode: (typeof SIGN_IN_MODES)[number], via: "button" | "card" = "button") {
  if (!import.meta.client) return
  document.cookie = `${ATTEMPT_COOKIE}=${via}; Path=/; Max-Age=600; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
  sendClientEvent({ event: "signin.clicked", mode, via })
}

export function countCardShown(
  reason: CardReason,
  page: { context?: object; hydrating?: boolean },
  send: (body: ClientEvent) => void = sendClientEvent,
) {
  if (page.context) Object.assign(page.context, { dropCardShown: reason })
  else if (!page.hydrating) send({ event: "card.shown", reason })
}
