import type { H3Event } from "h3"
import * as v from "valibot"
import { isRealtimeAvailable } from "vite-hub/realtime/server"
import { siteMatches } from "#shared/review"
import { type DropRow, findDrop } from "./drops"
import { type Identity, identify } from "./identity"
import { isMember, membersOnly } from "./members"
import { keyedName, openable, type ReviewClaims, reviewer, seal, unseal } from "./review"

export const PRESENCE = isRealtimeAvailable()

export const presenceRoom = (event: H3Event, drop: Pick<DropRow, "id">) => keyedName(event, "presence", drop.id)

const Ticket = v.object({ d: v.string(), u: v.string(), o: v.string(), e: v.number() })

const TICKET_MS = 3_600_000

export async function presenceTicket(event: H3Event, claims: ReviewClaims, now = Date.now()) {
  if (!claims.u) return null
  const expiresAt = Math.min(now + TICKET_MS, claims.e)
  const ticket = await seal(event, "presence", { d: claims.d, u: claims.u, o: claims.o, e: expiresAt })
  return { ticket, expiresAt }
}

interface Member {
  who: Identity
  drop: DropRow
  origin: string | null
}

const members = new WeakMap<object, Member | null>()

async function memberOf(event: H3Event, request: Request, now = Date.now()): Promise<Member | null> {
  if (members.has(event)) return members.get(event)!
  const found = await resolve(event, request, now)
  members.set(event, found)
  return found
}

async function resolve(event: H3Event, request: Request, now: number): Promise<Member | null> {
  const params = new URL(request.url).searchParams
  const text = params.get("ticket")
  if (text !== null) {
    const ticket = await unseal(event, "presence", Ticket, text)
    if (!ticket || ticket.e <= now || request.headers.get("origin") !== ticket.o) return null
    const [who, drop] = await Promise.all([reviewer({ u: ticket.u }), findDrop(ticket.d, event)])
    if (!who || drop?.kind !== "site" || !drop.siteUrl || !siteMatches(drop.siteUrl, ticket.o)) return null
    return { who, drop, origin: ticket.o }
  }
  const id = params.get("drop")
  if (!id) return null
  const [who, drop] = await Promise.all([identify(event), findDrop(id, event)])
  if (who?.actorKind !== "browser" || !drop) return null
  if (membersOnly() && !(await isMember(who.userId, event))) return null
  return { who, drop, origin: null }
}

export async function presenceOrigin(event: H3Event, request: Request, origin: string) {
  const member = await memberOf(event, request)
  return member?.origin === origin
}

export async function presenceIdentity(event: H3Event, request: Request) {
  const member = await memberOf(event, request)
  if (!member || !openable(member.drop, member.who)) return null
  const { userId, name, image } = member.who
  return { id: userId, name, ...(image ? { image } : {}) }
}

export async function presenceAllows(event: H3Event, request: Request, documentId: string | null, mode: string) {
  if (mode !== "read" || documentId === null) return false
  const member = await memberOf(event, request)
  return Boolean(member && openable(member.drop, member.who) && documentId === (await presenceRoom(event, member.drop)))
}
