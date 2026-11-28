import { browser } from "wxt/browser"
import type { Hand } from "./messages"

export interface Client {
  clientId: string
  redirectUri: string
}

export interface Link {
  drop: string
  clientId: string
  refreshToken: string
  name?: string
  email?: string
}

export interface Access {
  drop: string
  token: string
  expiresAt: number
}

export interface SiteIndex {
  drop: string
  etag?: string
  origins: string[]
  at: number
}

interface Local {
  drop: string
  hello: { drop: string; name: string; content?: string }
  clients: Record<string, Client>
  link: Link
  hand: Hand
  kept: string[]
  welcomed: boolean
  picked: Record<string, string>
}

interface Session {
  open: Record<string, string>
  access: Access
  index: SiteIndex
}

async function get<T extends object, K extends keyof T & string>(
  area: "local" | "session",
  key: K,
): Promise<T[K] | undefined> {
  const values = await browser.storage[area].get(key)
  // SAFETY: only this module writes these keys, with the types above.
  return values[key] as T[K] | undefined
}

export const local = {
  get: <K extends keyof Local>(key: K) => get<Local, K>("local", key),
  set: <K extends keyof Local>(key: K, value: Local[K]) => browser.storage.local.set({ [key]: value }),
  remove: (key: keyof Local) => browser.storage.local.remove(key),
}

export const session = {
  get: <K extends keyof Session>(key: K) => get<Session, K>("session", key),
  set: <K extends keyof Session>(key: K, value: Session[K]) => browser.storage.session.set({ [key]: value }),
  remove: (key: keyof Session) => browser.storage.session.remove(key),
}

export async function trustedOnly() {
  for (const area of [browser.storage.local, browser.storage.session]) {
    if (typeof area.setAccessLevel === "function")
      await Promise.resolve()
        .then(() => area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }))
        .catch(() => undefined)
  }
}
