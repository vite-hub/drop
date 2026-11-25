import type {
  CommentSendAgent,
  CommentSendEvent,
  CommentSendPairingCheck,
  CommentSendResult,
  CommentSendTransport,
} from "vite-hub/comments/client"
import { waitingForAnswer } from "../../shared/feedback"
import type { DropComment, SendSetup } from "../../shared/types"
import type { DropSend, SendEndpoint, SendTestResult } from "../../app/utils/comment-send"

// A Send server that keeps everything in the page, for the pill's browser test: its controls play the agent and the
// server, which is how the test reaches each state. Send N counts as ViteHub's does: every open thread, from anyone,
// that waits for an answer and has a message no send carried yet.

/** Who reads, and the drop's comments as they load. */
interface StubReader {
  me: string
  comments: () => DropComment[]
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
  /** The server has no usable VITEHUB_WEBHOOKS_KEY, so pairing throws, as ViteHub's handler does, until `setUp`. */
  unset: (setup: SendSetup) => void
  setUp: () => void
}

export function createStubSend({ me, comments }: StubReader): DropSend & { controls: StubSendControls } {
  let endpoint: SendEndpoint | null = null
  let pairing: {
    code: string
    expiresAt: number
    agent?: CommentSendAgent
    owner: symbol
    batch: Map<string, number>
  } | null = null
  // Per drop, the time each thread's last message had when a send carried it.
  const carried = new Map<string, Map<string, number>>()
  let working: { id: string; drop: string; thread?: string } | null = null
  let nextAnswer: Exclude<CommentSendResult, { status: "sent" }> | null = null
  let nextTest: SendTestResult | null = null
  let sends = 0
  let held: { promise: Promise<void>; release: () => void } | null = null
  let setup: SendSetup = { problem: null, admin: false }
  const changes = new Set<() => void>()
  const events = new Set<{ owner: symbol; listener: (event: CommentSendEvent) => void }>()
  const changed = () => changes.forEach((listener) => listener())
  const emit = (event: CommentSendEvent, owner?: symbol) => {
    for (const entry of events) if (!owner || entry.owner === owner) entry.listener(event)
  }

  const t3: CommentSendAgent = { name: "T3 Code", logo: "t3", host: "relay.t3.codes" }

  function transport(drop: string): CommentSendTransport {
    const owner = Symbol()
    // Send N: every open thread, from anyone, that waits for an answer and has a message no send carried yet.
    const unsent = () => {
      const sent = carried.get(drop)
      const batch = new Map<string, number>()
      for (const thread of waitingForAnswer(comments(), { me })) {
        const at = lastMessageAt(thread)
        if ((sent?.get(thread.id) ?? -1) < at) batch.set(thread.id, at)
      }
      return batch
    }
    const deliver = async (agent: CommentSendAgent, batch: Map<string, number>): Promise<CommentSendResult> => {
      await held?.promise
      if (nextAnswer) {
        const answer = nextAnswer
        nextAnswer = null
        return answer.status === "failed" && answer.problem === "delivery" ? { ...answer, agent } : answer
      }
      const sent = carried.get(drop) ?? new Map<string, number>()
      for (const [id, at] of batch) sent.set(id, Math.max(sent.get(id) ?? -1, at))
      carried.set(drop, sent)
      endpoint = { agent, lastSentAt: Date.now() }
      working = { id: `send-${++sends}`, drop }
      changed()
      return { status: "sent", id: working.id }
    }
    return {
      status: async () => {
        const batch = unsent()
        if (pairing?.owner === owner) {
          const previous = pairing.batch.size
          pairing.batch = batch
          if (previous !== batch.size) emit({ type: "count", count: batch.size }, owner)
        }
        return {
          count: batch.size,
          ...(endpoint ? { agent: endpoint.agent } : {}),
          ...(working?.drop === drop
            ? { working: { id: working.id, ...(working.thread ? { thread: working.thread } : {}) } }
            : {}),
        }
      },
      startPairing: async () => {
        if (setup.problem) throw new Error('[POST] "/api/send/pairing": 500 Server Error')
        const code = crypto.randomUUID().slice(0, 7).toUpperCase()
        pairing = { code, expiresAt: Date.now() + PAIRING_MS, owner, batch: unsent() }
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
        if (pairing?.owner !== owner || pairing.code !== code || !pairing.agent)
          return { status: "failed", reason: "The setup code is not paired." }
        if (setup.problem)
          return {
            status: "failed",
            problem: setup.problem === "unset" ? "key-unset" : "key-invalid",
            reason: "Cannot open receiver.",
          }
        const { agent, batch } = pairing
        endpoint = { agent, lastSentAt: null }
        pairing = null
        changed()
        return deliver(agent, batch)
      },
      cancel: async (code) => {
        if (pairing?.code === code) pairing = null
      },
      send: async () =>
        endpoint ? deliver(endpoint.agent, unsent()) : { status: "failed", reason: "No agent is connected." },
      subscribe: (listener) => {
        const entry = { owner, listener }
        events.add(entry)
        return () => events.delete(entry)
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
    setup: async () => setup,
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
      unset: (next) => (setup = next),
      setUp: () => (setup = { ...setup, problem: null }),
    },
  }
}
