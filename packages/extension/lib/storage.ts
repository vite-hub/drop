import { browser } from "wxt/browser"
import type { Hand } from "./messages"

export interface Client {
  clientId: string
  redirectUri: string
}

export interface Link {
  drop: string
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  name?: string
  email?: string
}

interface Local {
  drop: string
  hello: { drop: string; name: string; content?: string }
  clients: Record<string, Client>
  link: Link
  hand: Hand
  kept: string[]
  welcomed: boolean
}

interface Session {
  open: Record<string, string>
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
}
