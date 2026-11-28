import { browser } from "wxt/browser"
import type { ReviewHostRequest } from "../../../shared/review-host"
import type { DropCheck } from "./deployment"
import type { PillStart } from "./host"

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
  "notes.targets": [Record<string, never>, PillStart]
  "review.host": [{ request: ReviewHostRequest }, unknown]
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
