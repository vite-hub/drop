import type { CommentSendAgent, CommentSendTransport } from "vite-hub/comments/client"
import { createCommentSendTransport } from "vite-hub/comments/client"

// Send's server, for the pill's Send segment (ViewerCommentSend) and the Send row of the Agents page. The pill talks to
// ViteHub Comments' Send routes (`send: true` in server/comments.ts) about the drop's page, and the Agents page to
// Drop's /api/send/endpoint, which shows, tests, and removes the member's agent.

/** The member's agent, as the Agents page lists it. */
export interface SendEndpoint {
  agent: CommentSendAgent
  /** When the last send went, in ms. */
  lastSentAt: number | null
}

/**
 * What a test delivery answered: the receiver's status and how long it took, or why it never arrived. An inbox has no
 * receiver, so its `code` is null.
 */
export type SendTestResult =
  | { status: "delivered"; code: number | null; ms: number }
  | { status: "failed"; reason: string }

export interface DropSend {
  /** The Send routes for one drop's page. */
  transport: (drop: string) => CommentSendTransport
  endpoint: () => Promise<SendEndpoint | null>
  /** Posts a test delivery to the member's agent. */
  test: () => Promise<SendTestResult>
  remove: () => Promise<void>
  /** Calls `listener` when the endpoint changes, such as after a pairing in the pill. Returns a function that stops it. */
  onChange: (listener: () => void) => () => void
}

function createDropSend(): DropSend {
  const changes = new Set<() => void>()
  const changed = () => changes.forEach((listener) => listener())
  return {
    transport: (drop) => {
      // Comments turns the page into the drop's subject (server/utils/handoffs.ts), and its link goes to the agent.
      const http = createCommentSendTransport({ page: `/d/${drop}` })
      return {
        ...http,
        // Allow saves the agent and sends, and a send moves "last sent": the Agents row follows both.
        allow: async (code, selection) => {
          const result = await http.allow(code, selection)
          changed()
          return result
        },
        send: async () => {
          const result = await http.send()
          changed()
          return result
        },
      }
    },
    endpoint: () => $fetch<SendEndpoint | null>("/api/send/endpoint"),
    test: () => $fetch<SendTestResult>("/api/send/endpoint/test", { method: "POST" }),
    remove: async () => {
      await $fetch("/api/send/endpoint", { method: "DELETE" })
      changed()
    },
    onChange: (listener) => {
      changes.add(listener)
      return () => changes.delete(listener)
    },
  }
}

/** The page's one Send: the pill and the Agents page share the member's endpoint. */
export const dropSend: DropSend = createDropSend()
