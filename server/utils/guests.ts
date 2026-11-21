import { getCookie, type H3Event } from "h3"
import { hex, sha256 } from "#shared/utils/bytes"

declare module "h3" {
  interface H3EventContext {
    dropGuest?: string | null
  }
}

const KEY = /^[\da-f]{32}$/
const MAX_AGE = 400 * 24 * 60 * 60

const cookieName = (event: H3Event) => (event.url.protocol === "https:" ? "__Host-drop_guest" : "drop_guest")

export const guestIdOf = async (key: string) => `guest:${hex(await sha256(new TextEncoder().encode(key))).slice(0, 32)}`

export function guestOf(event: H3Event, options: { mint: true }): Promise<string>
export function guestOf(event: H3Event, options?: { mint?: boolean }): Promise<string | null>
export async function guestOf(event: H3Event, { mint = false } = {}): Promise<string | null> {
  const page = event.context.dropPage ?? event
  if (page.context.dropGuest || (page.context.dropGuest === null && !mint)) return page.context.dropGuest
  const name = cookieName(event)
  const sent = getCookie(event, name)
  if (sent && KEY.test(sent)) return (page.context.dropGuest = await guestIdOf(sent))
  if (!mint) return (page.context.dropGuest = null)
  const key = hex(crypto.getRandomValues(new Uint8Array(16)))
  const secure = event.url.protocol === "https:" ? "; Secure" : ""
  const cookie = `${name}=${key}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure}`
  const cookies = (page.context.dropSessionCookies ??= [])
  cookies.push(cookie)
  return (page.context.dropGuest = await guestIdOf(key))
}
