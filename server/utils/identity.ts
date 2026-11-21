import { eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { requireCaller, useAuth } from "vite-hub/auth/server"
import { db } from "vite-hub/database"
import { user as users } from "../databases/default/index"
import { logActor, logDenied, logError, requestLog } from "./logs"
import { isMember, rethrowMembershipOutage } from "./members"
import { type TeamRole, teamsOf } from "./teams"
import { useServerEnv } from "vite-hub/env"
import { type Role, roleFor } from "#shared/roles"
import type { ActorKind } from "#shared/types"

// What Drop's middleware leaves on the event for later handlers. Declared here, beside the identity lookup that reads
// it, because the app and shared/ typecheck this file through their imports, outside the server project.
declare module "h3" {
  interface H3EventContext {
    /** The access gate's identity lookup, shared so error pages don't look the caller up again. */
    dropIdentity?: Promise<Identity | null>
    /** On a page render's own API call (useApi), the page's request: same visitor, same cookie, already identified. */
    dropPage?: H3Event
    dropAccessChecked?: boolean
    dropSessionCookies?: string[]
  }
}

/** Who is calling and how: a person in the browser, or an agent through an MCP client they approved. */
export interface Identity {
  userId: string
  name: string
  email: string
  image: string | null
  role: Role
  actorKind: ActorKind
  /** Shown on drops: the MCP client's name (often the agent, like "Claude Code") or the person's name. */
  actorName: string
  /** The teams they're on and their role on each, on a personal Drop with teams (./teams.ts). */
  teams?: Record<string, TeamRole>
}

/**
 * Someone's role, from `DROP_ADMINS`: an admin when their email is in it and a sign-in method verified it, whichever one
 * (GitHub, another provider, email). Everyone else is a member. Outside `nuxt dev` and the runtime tests an unverified
 * email never counts, so nobody becomes an admin by typing someone else's address.
 */
export const roleOf = (
  person: { email: string; emailVerified?: boolean | null },
  admins = useServerEnv().drop.admins.unseal(),
): Role => roleFor(person, admins, import.meta.dev === true || useServerEnv().drop.testSignin)

/**
 * Writes the role `DROP_ADMINS` gives someone to their account, for Better Auth's admin endpoints (bans) that read it from
 * there. Drop itself reads `roleOf` on every request, so a change to `DROP_ADMINS` takes effect on restart either way.
 */
export async function syncRole(userId: string) {
  const [row] = await db
    .select({ email: users.email, emailVerified: users.emailVerified, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (row && row.role !== roleOf(row))
    await db
      .update(users)
      .set({ role: roleOf(row) })
      .where(eq(users.id, userId))
}

export const authFor = (event: H3Event) => useAuth(event)

/**
 * The browser's session, with its cookie kept in step. Once a day Better Auth extends a session: it writes the new expiry
 * to the database and sends a fresh cookie on the call's own response. A server-side call drops that response, so
 * without this the cookie lapsed a week after sign-in while the database still said the session was live. Keep the
 * cookies for the final response hook, since an error handler can replace the response and its headers.
 */
export async function sessionOf(event: H3Event) {
  const { headers, response } = await authFor(event).api.getSession({
    headers: event.req.headers,
    returnHeaders: true,
  })
  const cookies = headers.getSetCookie()
  if (cookies.length) (event.context.dropSessionCookies ??= []).push(...cookies)
  return response
}

export const bearerFrom = (headers: Headers) => headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null

/**
 * Who is calling. Resolved once per request (middleware and route share it), and once per page render: the API calls a
 * page makes while it renders on the server (useApi) take the page's.
 */
export function identify(event: H3Event): Promise<Identity | null> {
  return (event.context.dropIdentity ??= (
    event.context.dropPage ? identify(event.context.dropPage) : verify(event)
  ).then((who) => {
    // Every request's wide event says who made it, never the credential itself.
    if (who) logActor(event, who)
    return who
  }))
}

async function verify(event: H3Event): Promise<Identity | null> {
  const who = await resolveIdentity(event)
  if (!who) return null
  // Both are a round trip to the database, so they start together.
  const [member, teams] = await Promise.all([isMember(who.userId, event), teamsOf(who.userId, event)])
  if (!member) {
    logDenied(event, "not-member")
    return null
  }
  who.teams = teams
  return who
}

/**
 * A person's browser session, or an MCP client's OAuth access token that this Drop issued. ViteHub reads the person and
 * the client again for a token, so a banned person or a deleted client loses access at once.
 * ViteHub puts session cookies on the prepared response; hold them for the final response hook as in `sessionOf`.
 */
async function resolveIdentity(event: H3Event): Promise<Identity | null> {
  const headers = event.res.headers
  const previousCookies = headers.getSetCookie()
  const result = await requireCaller(event)
    .catch((error: unknown) => {
      // An outage answers 503; any other failure answers as signed out, and the wide event keeps why.
      rethrowMembershipOutage(error)
      logError(event, error, { identity: { session: "failed" } })
      return null
    })
    .finally(() => {
      const cookies = headers.getSetCookie().filter((cookie) => !previousCookies.includes(cookie))
      if (!cookies.length) return
      headers.delete("Set-Cookie")
      for (const cookie of previousCookies) headers.append("Set-Cookie", cookie)
      const sessionCookies = (event.context.dropSessionCookies ??= [])
      sessionCookies.push(...cookies)
    })
  if (!result) return null
  const [error, caller] = result
  if (error) {
    // The client only sees a 401, so the wide event keeps which token check failed.
    if (error.code === "AUTH_MCP_TOKEN_INVALID") requestLog(event)?.set({ token: { rejected: error.message } })
    return null
  }
  const { user } = caller
  if (caller.kind === "browser" && user.banned) {
    logDenied(event, "banned")
    return null
  }
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: roleOf(user),
    actorKind: caller.kind,
    // An agent shows as its MCP client, often the agent itself, like "Claude Code".
    actorName: caller.kind === "agent" ? (caller.client.name ?? "MCP client") : user.name,
  }
}

/**
 * Someone in this Drop as their browser session would be, by their id, without a request: whom an `@` may name, and
 * whether they may read the drop it's on. Null for a banned account, or one the member list leaves out.
 */
export async function identityOf(userId: string): Promise<Identity | null> {
  const [person] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!person || person.banned) return null
  const [member, teams] = await Promise.all([isMember(person.id), teamsOf(person.id)])
  if (!member) return null
  return {
    userId: person.id,
    name: person.name,
    email: person.email,
    image: person.image ?? null,
    role: roleOf(person),
    actorKind: "browser",
    actorName: person.name,
    teams,
  }
}

export async function requireIdentity(event: H3Event): Promise<Identity> {
  const who = await identify(event)
  if (who) return who
  event.res.headers.set("WWW-Authenticate", 'Bearer realm="drop"')
  throw new HTTPError({ status: 401, statusText: "Sign in, or connect your agent through Drop's MCP server." })
}

/**
 * An admin, in the browser. An agent an admin connected is not enough: what it reads (a guest's comment, say) can
 * steer it, so it never approves shares, reads reports, quarantines, or changes members and skills.
 */
export async function requireAdmin(event: H3Event): Promise<Identity> {
  const who = await requireIdentity(event)
  if (who.role !== "admin" || who.actorKind !== "browser")
    throw new HTTPError({ status: 403, statusText: "Only admins, in the browser, can do that." })
  return who
}
