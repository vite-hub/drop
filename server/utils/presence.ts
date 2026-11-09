import type { H3Event } from "h3"
import * as v from "valibot"
import { isRealtimeAvailable } from "vite-hub/realtime/server"
import { siteMatches } from "#shared/review"
import { type DropRow, findDrop } from "./drops"
import { type Identity, identify } from "./identity"
import { isMember, membersOnly } from "./members"
import { keyedName, openable, type ReviewClaims, reviewer, seal, unseal } from "./review"

/**
 * Presence: who has a drop open right now, whether they're active, and where their pointer is, through one Realtime
 * room per drop (server/realtime/presence.ts). Drop's own pages join with Drop's session. A reviewed site's page joins
 * through review.js with a presence ticket instead, which it trades its review token for (/api/review/presence): a
 * WebSocket can't carry the token's header, and a URL ends up in logs, so the ticket is short-lived and good for
 * nothing else.
 *
 * Only people who could open the drop without its link join, as for "Open in Drop" (`openable`): its owner, admins, and
 * the people a team share reaches. A public link doesn't count, so a stranger on one never learns who else is reading.
 */

/** Only hosts with Realtime rooms (Cloudflare, VPS) have presence. */
export const PRESENCE = isRealtimeAvailable()

/** A room's name: the drop's, keyed, so a reviewed site's page in the room can't tell which drop it is. */
export const presenceRoom = (event: H3Event, drop: Pick<DropRow, "id">) => keyedName(event, "presence", drop.id)

/** What a presence ticket says: the site drop, the person, the page's origin, until when. */
const Ticket = v.object({ d: v.string(), u: v.string(), o: v.string(), e: v.number() })

/** A ticket lasts an hour at most, and never past the review token it came from. */
const TICKET_MS = 3_600_000

/** A presence ticket for a review session's page, or null for a guest, who doesn't join. */
export async function presenceTicket(event: H3Event, claims: ReviewClaims, now = Date.now()) {
  if (!claims.u) return null
  const expiresAt = Math.min(now + TICKET_MS, claims.e)
  const ticket = await seal(event, "presence", { d: claims.d, u: claims.u, o: claims.o, e: expiresAt })
  return { ticket, expiresAt }
}

/** Who and what a connection is for: the person, the drop they asked for, and the origin a ticket was for. */
interface Member {
  who: Identity
  drop: DropRow
  /** The reviewed site's origin, for a ticket; null on Drop's own pages. */
  origin: string | null
}

// What identify() found for a request, so authorize() for the same request doesn't look it up again.
const members = new WeakMap<object, Member | null>()

/**
 * The person and drop behind a request. A ticket in the query wins, and then only the ticket counts: a cross-site
 * handshake carries Drop's cookies too, so a session never identifies a request from another origin. Drop's own pages
 * name the drop in `drop`.
 */
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
    // The site must still cover the page, as for every review request (reviewSession).
    if (!who || drop?.kind !== "site" || !drop.siteUrl || !siteMatches(drop.siteUrl, ticket.o)) return null
    return { who, drop, origin: ticket.o }
  }
  const id = params.get("drop")
  if (!id) return null
  const [who, drop] = await Promise.all([identify(event), findDrop(id, event)])
  if (who?.actorKind !== "browser" || !drop) return null
  // The members-only gate lets this path through (0.2.members-only.ts), so it checks membership here.
  if (membersOnly() && !(await isMember(who.userId))) return null
  return { who, drop, origin: null }
}

/** A reviewed site's page may connect when it carries a ticket for that very origin. */
export async function presenceOrigin(event: H3Event, request: Request, origin: string) {
  const member = await memberOf(event, request)
  return member?.origin === origin
}

/** The person a connection shows as, bound by the server so nobody shows as someone else. */
export async function presenceIdentity(event: H3Event, request: Request) {
  const member = await memberOf(event, request)
  if (!member || !openable(member.drop, member.who)) return null
  const { userId, name, image } = member.who
  return { id: userId, name, ...(image ? { image } : {}) }
}

/**
 * Presence rooms are read-only: people share their state through awareness and never write to the room. A connection
 * joins its own drop's room only, so a ticket for one review can't reach another drop.
 */
export async function presenceAllows(event: H3Event, request: Request, documentId: string | null, mode: string) {
  if (mode !== "read" || documentId === null) return false
  const member = await memberOf(event, request)
  return Boolean(member && openable(member.drop, member.who) && documentId === (await presenceRoom(event, member.drop)))
}
