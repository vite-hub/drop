export const REVIEW_HOST_VERSION = 1

export type ReviewTarget = { id: string; name: string; access: string }

export type ReviewSession = { name: string; expiresAt: number; title?: string }

export type HostResponse = { status: number; type?: string; text?: string; base64?: string }

export type HostFile = { field: "screenshot" | "image"; name: string; type: string; base64: string }

export type PresenceTicket = {
  room: string
  ticket: string
  you: { id: string; name: string; image?: string }
  expiresAt: number
}

type Base = { v: typeof REVIEW_HOST_VERSION; target: string }

export type ReviewHostRequest =
  | (Base & { type: "session"; clear?: true })
  | (Base & { type: "connect"; origin: string })
  | (Base & { type: "list"; page: string; refresh?: true })
  | (Base & { type: "call"; path: string; method: "GET" | "POST" | "PATCH"; json?: unknown })
  | (Base & { type: "upload"; path: string; data: unknown; files: HostFile[] })
  | (Base & { type: "related"; probe?: true })
  | (Base & { type: "open"; what: "copy-link" | "copy-prompt" | "review" })
  | (Base & { type: "capture" })
  | (Base & { type: "presence" })

export type ReviewHostReply = {
  session: ReviewSession | null
  connect: ReviewSession
  list: HostResponse
  call: HostResponse
  upload: HostResponse
  related: HostResponse
  open: { opened: boolean }
  capture: { dataUrl: string }
  presence: HostResponse
}

export type ReviewHostSend = <T extends ReviewHostRequest["type"]>(
  message: Extract<ReviewHostRequest, { type: T }>,
) => Promise<ReviewHostReply[T]>

export type ReviewRealtime = {
  connectRealtimeRoom(
    kind: "presence",
    room: string,
    options: { origin: string; params: { ticket: string }; identity: PresenceTicket["you"] },
  ): unknown
}

export type ReviewHost = {
  version: typeof REVIEW_HOST_VERSION
  drop: string
  targets: ReviewTarget[]
  target?: string
  send: ReviewHostSend
  realtime?: ReviewRealtime
}
