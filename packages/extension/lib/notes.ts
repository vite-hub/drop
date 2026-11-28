import type { ReviewFetch, ReviewReply } from "./messages"
import { accessToken, linked, onUnlink, refresh, Unlinked } from "./oauth"
import { hold, release } from "./secrets"

const EARLY = 30_000

export class NotesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function drop() {
  const link = await linked()
  if (!link) throw new Unlinked("Not linked.")
  return link.drop
}

async function notes(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const base = await drop()
  for (const renew of [false, true]) {
    const token = renew ? (await refresh()).accessToken : await accessToken()
    const response = await fetch(`${base}/api/review/notes/${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (response.status !== 401) return response
  }
  throw new NotesError("The Drop refused this account's token.", 401)
}

async function json(response: Response) {
  if (!response.ok) throw new NotesError(`The Drop answered ${response.status}.`, response.status)
  const body: unknown = await response.json()
  return body
}

let index: { drop: string; etag: string; body: unknown } | undefined

export async function notesIndex() {
  const base = await drop()
  const cached = index?.drop === base ? index : undefined
  const response = await notes("index", cached ? { headers: { "if-none-match": cached.etag } } : {})
  if (cached && response.status === 304) return cached.body
  const body = await json(response)
  const etag = response.headers.get("etag")
  index = etag ? { drop: base, etag, body } : undefined
  return body
}

export async function notesTargets(origin: string) {
  return json(await notes("targets", { method: "POST", body: { origin } }))
}

interface Session {
  token: string
  expires: number
}

const sessions = new Map<string, Session>()
const opening = new Map<string, Promise<Session>>()

onUnlink(() => {
  for (const { token } of sessions.values()) release(token)
  sessions.clear()
  opening.clear()
  index = undefined
})

const sessionKey = (base: string, origin: string, target: string | undefined) => `${base}\n${origin}\n${target ?? ""}`

export async function reviewSession(
  origin: string,
  { target, create = false }: { target?: string; create?: boolean } = {},
) {
  const base = await drop()
  const key = sessionKey(base, origin, target)
  const cached = sessions.get(key)
  if (!create && cached && cached.expires - EARLY > Date.now()) return cached
  const pending = opening.get(key)
  if (pending) return pending
  const started = open(key, origin, target, create).finally(() => opening.delete(key))
  opening.set(key, started)
  return started
}

async function open(key: string, origin: string, target: string | undefined, create: boolean) {
  const body = await json(
    await notes("session", {
      method: "POST",
      body: { origin, ...(target ? { target } : {}), ...(create ? { create } : {}) },
    }),
  )
  // SAFETY: the session contract above; the fields are checked next.
  const { token, expires } = (body ?? {}) as Partial<Session>
  if (typeof token !== "string" || typeof expires !== "number") throw new NotesError("The Drop sent no review session.")
  hold(token)
  const previous = sessions.get(key)
  if (previous) release(previous.token)
  const session = { token, expires }
  sessions.set(key, session)
  return session
}

function forget(key: string, token: string) {
  if (sessions.get(key)?.token !== token) return
  sessions.delete(key)
  release(token)
}

function reviewUrl(base: string, path: string) {
  if (!path.startsWith("/")) return undefined
  const url = new URL(path, base)
  if (url.origin !== base) return undefined
  if (!url.pathname.startsWith("/api/review/") || url.pathname.startsWith("/api/review/notes")) return undefined
  return url
}

const TEXT = /^(text\/|application\/(json|[\w.+-]+\+json|javascript|xml))/

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

export async function reviewFetch(origin: string, request: ReviewFetch): Promise<ReviewReply> {
  const base = await drop()
  const url = reviewUrl(base, request.path)
  if (!url) throw new NotesError("That path isn't part of the review API.")
  const key = sessionKey(base, origin, request.target)
  for (const retry of [false, true]) {
    const { token } = await reviewSession(origin, { target: request.target })
    const response = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    })
    if (response.status === 401 && !retry) {
      forget(key, token)
      continue
    }
    const type = response.headers.get("content-type") ?? undefined
    if ([204, 205, 304].includes(response.status)) return { status: response.status, ...(type ? { type } : {}) }
    return type === undefined || TEXT.test(type)
      ? { status: response.status, ...(type ? { type } : {}), text: await response.text() }
      : { status: response.status, type, base64: base64(await response.arrayBuffer()) }
  }
  throw new NotesError("The Drop refused the review session.", 401)
}
