import { getCookie, type H3Event } from "h3"
import { hex, sha256 } from "#shared/utils/bytes"

/**
 * Guests: people on a "Can comment" link who aren't signed in. Each browser keeps a random key in an httpOnly cookie,
 * and its guest id is the key's SHA-256. So a guest's resend is the same author as the first try, and their comments
 * are still theirs after a reload. Every reader sees the id (a comment's `authorId`), never the key, and the hash can't
 * be turned back into it, so nobody writes or deletes as another guest. No secret goes into it, so a Worker and a VPS
 * read it alike. Over HTTPS the cookie is `__Host-`, which no other origin, such as a drop's own one, can set.
 */

declare module "h3" {
  interface H3EventContext {
    /** This request's guest id, once read or made. */
    dropGuest?: string | null
  }
}

const KEY = /^[\da-f]{32}$/
// The most a browser keeps a cookie (RFC 6265bis): about 400 days.
const MAX_AGE = 400 * 24 * 60 * 60

const cookieName = (event: H3Event) => (event.url.protocol === "https:" ? "__Host-drop_guest" : "drop_guest")

/** The guest id a key stands for, as comments store it in `author.id`. */
export const guestIdOf = async (key: string) => `guest:${hex(await sha256(new TextEncoder().encode(key))).slice(0, 32)}`

/**
 * The guest id of this browser, from its cookie, or null when it has none. With `mint`, a browser without one gets a
 * new key, and the answer sets its cookie: with the session's cookies (server/plugins/content-headers.ts), so an error
 * answer sets it too, and during a page render it goes on the page's answer, which is the one the browser gets.
 */
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
