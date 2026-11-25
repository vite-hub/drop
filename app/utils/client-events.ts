import type * as v from "valibot"
import type { ClientEventSchema, SIGN_IN_MODES } from "#shared/schemas"

export type ClientEvent = v.InferInput<typeof ClientEventSchema>

const CLICKED_COOKIE = "drop-signin-clicked"

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

export function reportSignInClicked(mode: (typeof SIGN_IN_MODES)[number]) {
  if (!import.meta.client) return
  document.cookie = `${CLICKED_COOKIE}=1; Path=/; Max-Age=600; SameSite=Lax`
  sendClientEvent({ event: "signin.clicked", mode })
}

export function reportSignInReturned() {
  if (!import.meta.client || !document.cookie.split("; ").includes(`${CLICKED_COOKIE}=1`)) return
  document.cookie = `${CLICKED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  sendClientEvent({ event: "signin.returned" })
}
