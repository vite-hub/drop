import type {
  CommentSendAgent,
  CommentSendEvent,
  CommentSendPairingCheck,
  CommentSendResult,
  CommentSendTransport,
} from "vite-hub/comments/client"
import { waitingForAnswer } from "#shared/feedback"
import type { DropComment } from "#shared/types"

// Send's server, for the pill's Send segment (ViewerCommentSend) and the Send row of the Agents page. This is a stub
// that keeps everything in the page: no agent can pair with its codes, and nothing leaves the browser. The HTTP
// transport over Comments `send: true` replaces `createStubSend` (D3); the pill and the Agents page keep `DropSend`.

/** The member's agent, as the Agents page lists it. */
export interface SendEndpoint {
  agent: CommentSendAgent
  /** When the last send went, in ms. */
  lastSentAt: number | null
}

/** What a test delivery answered: the receiver's status and how long it took, or why it never arrived. */
export type SendTestResult = { status: "delivered"; code: number; ms: number } | { status: "failed"; reason: string }

/** One drop's Send segment: the drop, the member's user id, and the drop's comments as they load. */
interface SendSubject {
  drop: string
  me: string
  comments: () => DropComment[]
}

export interface DropSend {
  transport: (subject: SendSubject) => CommentSendTransport
  endpoint: () => Promise<SendEndpoint | null>
  /** Posts a test delivery to the member's agent. */
  test: () => Promise<SendTestResult>
  remove: () => Promise<void>
  /** Calls `listener` when the endpoint changes, such as after a pairing in the pill. Returns a function that stops it. */
  onChange: (listener: () => void) => () => void
}

/** When a thread last got a message: a send carries a thread until someone writes in it again. */
const lastMessageAt = (thread: DropComment) =>
  Math.max(thread.createdAt, ...thread.replies.map((reply) => reply.createdAt))

const PAIRING_MS = 10 * 60_000

/** The stub's controls, which play the agent and the server: they are how a test reaches each state. */
export interface StubSendControls {
  /** The agent uses the setup code. */
  pair: (agent: CommentSendAgent) => void
  /** The agent starts on the last send, with the URL of its thread. */
  work: (thread?: string) => void
  /** The agent finishes the last send. */
  finish: () => void
  /** The next send or Allow answers with this instead of Sent. */
  answer: (result: Exclude<CommentSendResult, { status: "sent" }>) => void
  /** The next test delivery answers with this. */
  answerTest: (result: SendTestResult) => void
  /** Sends wait until `release`, so Sending stays on screen. */
  hold: () => void
  release: () => void
}

export function createStubSend(): DropSend & { controls: StubSendControls } {
  let endpoint: SendEndpoint | null = null
  let pairing: { code: string; expiresAt: number; agent?: CommentSendAgent } | null = null
  // Per drop, the time each thread's last message had when a send carried it.
  const carried = new Map<string, Map<string, number>>()
  let working: { id: string; drop: string; thread?: string } | null = null
  let nextAnswer: Exclude<CommentSendResult, { status: "sent" }> | null = null
  let nextTest: SendTestResult | null = null
  let sends = 0
  let held: { promise: Promise<void>; release: () => void } | null = null
  const changes = new Set<() => void>()
  const events = new Set<(event: CommentSendEvent) => void>()
  const changed = () => changes.forEach((listener) => listener())
  const emit = (event: CommentSendEvent) => events.forEach((listener) => listener(event))

  const t3: CommentSendAgent = { name: "T3 Code", logo: "t3", host: "relay.t3.codes" }

  function transport({ drop, me, comments }: SendSubject): CommentSendTransport {
    // Send N: every open thread, from anyone, that waits for an answer and has a message no send carried yet.
    const unsent = () => {
      const sent = carried.get(drop)
      return waitingForAnswer(comments(), { me }).filter(
        (thread) => (sent?.get(thread.id) ?? -1) < lastMessageAt(thread),
      )
    }
    const deliver = async (agent: CommentSendAgent): Promise<CommentSendResult> => {
      await held?.promise
      if (nextAnswer) {
        const answer = nextAnswer
        nextAnswer = null
        return answer
      }
      const sent = carried.get(drop) ?? new Map<string, number>()
      for (const thread of unsent()) sent.set(thread.id, lastMessageAt(thread))
      carried.set(drop, sent)
      endpoint = { agent, lastSentAt: Date.now() }
      working = { id: `send-${++sends}`, drop }
      changed()
      return { status: "sent", id: working.id }
    }
    return {
      status: async () => ({
        count: unsent().length,
        ...(endpoint ? { agent: endpoint.agent } : {}),
        ...(working?.drop === drop
          ? { working: { id: working.id, ...(working.thread ? { thread: working.thread } : {}) } }
          : {}),
      }),
      startPairing: async () => {
        const code = crypto.randomUUID().slice(0, 7).toUpperCase()
        pairing = { code, expiresAt: Date.now() + PAIRING_MS }
        return {
          code,
          expiresAt: pairing.expiresAt,
          agent: t3,
          prompt: `Connect this Drop's comments to this T3 thread with the one-time setup code ${code}. It works for 10 minutes.`,
        }
      },
      pollPairing: async (code): Promise<CommentSendPairingCheck> => {
        if (pairing?.code !== code || Date.now() >= pairing.expiresAt) return { status: "expired" }
        return pairing.agent ? { status: "paired", agent: pairing.agent } : { status: "waiting" }
      },
      allow: async (code) => {
        if (pairing?.code !== code || !pairing.agent)
          return { status: "failed", reason: "The setup code is not paired." }
        const { agent } = pairing
        endpoint = { agent, lastSentAt: null }
        pairing = null
        changed()
        return deliver(agent)
      },
      cancel: async (code) => {
        if (pairing?.code === code) pairing = null
      },
      send: async () => (endpoint ? deliver(endpoint.agent) : { status: "failed", reason: "No agent is connected." }),
      subscribe: (listener) => {
        events.add(listener)
        return () => events.delete(listener)
      },
    }
  }

  return {
    transport,
    endpoint: async () => endpoint,
    test: async () => {
      if (!endpoint) return { status: "failed", reason: "No agent is connected." }
      const result = nextTest ?? { status: "delivered", code: 202, ms: 0 }
      nextTest = null
      return result
    },
    remove: async () => {
      endpoint = null
      changed()
    },
    onChange: (listener) => {
      changes.add(listener)
      return () => changes.delete(listener)
    },
    controls: {
      pair: (agent) => {
        if (pairing) pairing.agent = agent
      },
      work: (thread) => {
        if (!working) return
        working.thread = thread
        emit({ type: "working", id: working.id, ...(thread ? { thread } : {}) })
      },
      finish: () => {
        if (!working) return
        const { id } = working
        working = null
        emit({ type: "done", id })
      },
      answer: (result) => (nextAnswer = result),
      answerTest: (result) => (nextTest = result),
      hold: () => {
        const { promise, resolve } = Promise.withResolvers<void>()
        held = { promise, release: resolve }
      },
      release: () => {
        held?.release()
        held = null
      },
    },
  }
}

/** The page's one Send: the pill and the Agents page share the member's endpoint. */
export const dropSend: DropSend = createStubSend()
