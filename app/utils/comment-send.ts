import type { CommentSendAgent, CommentSendTransport } from "vite-hub/comments/client"
import { createCommentSendTransport } from "vite-hub/comments/client"
import type { SendSetup } from "#shared/types"

export interface SendEndpoint {
  agent: CommentSendAgent
  lastSentAt: number | null
}

export type SendTestResult =
  | { status: "delivered"; code: number | null; ms: number }
  | { status: "failed"; reason: string }

export type SendFailureDetails =
  | { cause: "setup"; problem: "unset" | "invalid"; admin: boolean }
  | { cause: "agent"; reason: string; agent: CommentSendAgent | null }
  | { cause: "reconnect" | "request"; reason: string }

export type SendFailure = SendFailureDetails & { tries: number; at: number }

export interface DropSend {
  transport: (drop: string) => CommentSendTransport
  endpoint: () => Promise<SendEndpoint | null>
  test: () => Promise<SendTestResult>
  remove: () => Promise<void>
  setup: () => Promise<SendSetup>
  onChange: (listener: () => void) => () => void
}

function createDropSend(): DropSend {
  const changes = new Set<() => void>()
  const changed = () => changes.forEach((listener) => listener())
  return {
    transport: (drop) => {
      const http = createCommentSendTransport({ page: `/d/${drop}` })
      return {
        ...http,
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
    setup: () => $fetch<SendSetup>("/api/send/setup"),
    onChange: (listener) => {
      changes.add(listener)
      return () => changes.delete(listener)
    },
  }
}

export const dropSend: DropSend = createDropSend()
