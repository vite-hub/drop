import { siteMatches } from "../../../shared/review"
import type { ReviewSession, ReviewTarget } from "../../../shared/review-host"
import { accessToken, linked, onUnlink, refresh, Unlinked } from "./oauth"
import { hold, release } from "./secrets"
import { session as stored, type SiteIndex } from "./storage"

const EARLY = 30_000
const INDEX_FRESH = 5 * 60_000

export const NOTES_TARGET: ReviewTarget = { id: "notes", name: "My notes", access: "Private" }

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
    const token = renew ? (await refresh()).access.token : await accessToken()
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

function originsOf(body: unknown) {
  const list = isRecord(body) && Array.isArray(body.origins) ? body.origins : []
  return list.filter((item): item is string => typeof item === "string")
}

let indexing: Promise<SiteIndex> | undefined

async function loadIndex(base: string, cached: SiteIndex | undefined) {
  const response = await notes("index", cached?.etag ? { headers: { "if-none-match": cached.etag } } : {})
  const at = Date.now()
  const next: SiteIndex =
    cached && response.status === 304
      ? { ...cached, at }
      : await json(response).then((body) => {
          const etag = response.headers.get("etag")
          return { drop: base, origins: originsOf(body), at, ...(etag ? { etag } : {}) }
        })
  if ((await linked())?.drop === base) await stored.set("index", next)
  return next
}

export async function siteIndex({ fresh = false } = {}) {
  const link = await linked()
  if (!link) return undefined
  if (indexing) return indexing
  const cached = await stored.get("index")
  const usable = cached?.drop === link.drop ? cached : undefined
  if (usable && !fresh && Date.now() - usable.at < INDEX_FRESH) return usable
  indexing ??= loadIndex(link.drop, usable).finally(() => {
    indexing = undefined
  })
  return indexing
}

export const indexed = (index: SiteIndex | undefined, origin: string) =>
  !!index && index.origins.some((address) => siteMatches(address, origin))

async function remember(origin: string) {
  const index = await stored.get("index")
  if (!index || indexed(index, origin)) return
  await stored.set("index", { ...index, origins: [...index.origins, origin] })
}

function targetsOf(body: unknown) {
  const list = isRecord(body) && Array.isArray(body.targets) ? body.targets : []
  const targets = list.flatMap((item): ReviewTarget[] =>
    isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.access === "string"
      ? [{ id: item.id, name: item.name, access: item.access }]
      : [],
  )
  return targets.some((target) => target.id === NOTES_TARGET.id) ? targets : [...targets, NOTES_TARGET]
}

export async function siteTargets(origin: string) {
  return targetsOf(await json(await notes("targets", { method: "POST", body: { origin } })))
}

interface Held {
  token: string
  expiresAt: number
  reply: ReviewSession
}

const sessions = new Map<string, Held>()
const opening = new Map<string, Promise<Held | null>>()

onUnlink(() => {
  for (const { token } of sessions.values()) release(token)
  sessions.clear()
  opening.clear()
  indexing = undefined
  void stored.remove("index")
})

const sessionKey = (base: string, origin: string, target: string) => `${base}\n${origin}\n${target}`

function live(key: string) {
  const held = sessions.get(key)
  return held && held.expiresAt - EARLY > Date.now() ? held : undefined
}

export async function reviewSession(origin: string, target: string, { create = false } = {}) {
  const base = await drop()
  const key = sessionKey(base, origin, target)
  const cached = live(key)
  if (cached) return cached
  const pending = opening.get(key)
  if (pending) {
    const found = await pending
    if (found || !create) return found
  }
  const started = open(key, origin, target, create).finally(() => {
    if (opening.get(key) === started) opening.delete(key)
  })
  opening.set(key, started)
  return started
}

export async function heldSession(origin: string, target: string) {
  const link = await linked()
  if (!link) return null
  const key = sessionKey(link.drop, origin, target)
  return live(key) ?? (await opening.get(key)) ?? null
}

async function open(key: string, origin: string, target: string, create: boolean) {
  const response = await notes("session", {
    method: "POST",
    body: { origin, target, ...(create ? { create: true } : {}) },
  })
  if (response.status === 404 && !create) return null
  const body = await json(response)
  const { token, expiresAt, name, title } = isRecord(body) ? body : {}
  if (typeof token !== "string" || typeof expiresAt !== "number")
    throw new NotesError("The Drop sent no review session.")
  hold(token)
  const previous = sessions.get(key)
  if (previous) release(previous.token)
  const held: Held = {
    token,
    expiresAt,
    reply: { name: typeof name === "string" ? name : "", expiresAt, ...(typeof title === "string" ? { title } : {}) },
  }
  sessions.set(key, held)
  if (create) await remember(origin)
  return held
}

export async function forgetSession(origin: string, target: string, token?: string) {
  const link = await linked()
  if (!link) return
  const key = sessionKey(link.drop, origin, target)
  const held = sessions.get(key)
  if (!held || (token && held.token !== token)) return
  sessions.delete(key)
  release(held.token)
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

export interface HostReply {
  status: number
  type?: string
  text?: string
  base64?: string
}

const ENDED: HostReply = {
  status: 401,
  type: "application/json",
  text: JSON.stringify({ message: "Your review session ended. Connect again to comment." }),
}

export async function reviewFetch(
  origin: string,
  target: string,
  path: string,
  init: { method: string; body?: () => BodyInit; type?: string },
): Promise<HostReply> {
  const base = await drop()
  const url = reviewUrl(base, path)
  if (!url) throw new NotesError("That path isn't part of the review API.")
  for (const retry of [false, true]) {
    const held = await reviewSession(origin, target)
    if (!held) return ENDED
    const response = await fetch(url, {
      method: init.method,
      headers: { authorization: `Bearer ${held.token}`, ...(init.type ? { "content-type": init.type } : {}) },
      body: init.body?.(),
    })
    if (response.status === 401 && !retry) {
      await forgetSession(origin, target, held.token)
      continue
    }
    const type = response.headers.get("content-type") ?? undefined
    if ([204, 205, 304].includes(response.status)) return { status: response.status, ...(type ? { type } : {}) }
    return type === undefined || TEXT.test(type)
      ? { status: response.status, ...(type ? { type } : {}), text: await response.text() }
      : { status: response.status, type, base64: base64(await response.arrayBuffer()) }
  }
  return ENDED
}
