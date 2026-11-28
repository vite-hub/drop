import { browser } from "wxt/browser"
import type { DropCheck } from "./deployment"

export type Hand = "press" | "everywhere"

interface Account {
  name?: string
  email?: string
}

export interface State {
  drop: string
  dropName?: string
  account?: Account
  hand: Hand
  kept: string[]
  site?: SiteState
}

export interface SiteState {
  origin: string
  blocked?: "drop" | "unsupported"
  kept: boolean
}

export type InjectResult =
  | { ok: true; origin: string }
  | { ok: false; reason: "no-grant" | "blocked" | "unsupported" | "failed"; error?: string }

export interface ReviewFetch {
  path: string
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  target?: string
}

export interface ReviewReply {
  status: number
  type?: string
  text?: string
  base64?: string
}

export interface PageRequests {
  "state.get": [{ tabId?: number }, State]
  "deployment.check": [{ drop: string }, DropCheck]
  "deployment.set": [{ drop: string }, State]
  "link.start": [Record<string, never>, State]
  "link.remove": [Record<string, never>, State]
  "hand.set": [{ hand: Hand }, State]
  "site.keep": [{ origin: string; keep: boolean }, State]
  "tab.inject": [{ tabId: number }, InjectResult]
}

export interface ContentRequests {
  "pill.closed": [Record<string, never>, null]
  "review.session": [{ target?: string; create?: boolean }, { expires: number }]
  "review.fetch": [ReviewFetch, ReviewReply]
  "review.presence": [{ target?: string }, unknown]
  "notes.index": [Record<string, never>, unknown]
  "notes.targets": [Record<string, never>, unknown]
}

export type Requests = PageRequests & ContentRequests
export type RequestType = keyof Requests
export type Message<K extends RequestType = RequestType> = { type: K } & Requests[K][0]

type Reply<K extends RequestType> = { ok: true; value: Requests[K][1] } | { ok: false; error: string }

class MessageError extends Error {}

export async function send<K extends RequestType>(type: K, payload: Requests[K][0]): Promise<Requests[K][1]> {
  // SAFETY: the background answers every message with a Reply for its type (lib/router.ts).
  const reply = (await browser.runtime.sendMessage({ ...payload, type })) as Reply<K> | undefined
  if (!reply) throw new MessageError(`No answer to ${type}`)
  if (!reply.ok) throw new MessageError(reply.error)
  return reply.value
}
