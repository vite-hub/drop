import { eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { requireCaller, useAuth } from "vite-hub/auth/server"
import { db } from "vite-hub/database"
import { user as users } from "../databases/default/index"
import { authError } from "./auth-errors"
import { logActor, logDenied, logError, requestLog } from "./logs"
import { isMember, rethrowMembershipOutage } from "./members"
import { type TeamRole, teamsOf } from "./teams"
import { useServerEnv } from "vite-hub/env"
import { type Role, roleFor } from "#shared/roles"
import type { ActorKind } from "#shared/types"

declare module "h3" {
  interface H3EventContext {
    dropIdentity?: Promise<Identity | null>
    dropPage?: H3Event
    dropSessionCookies?: string[]
  }
}

export interface Identity {
  userId: string
  name: string
  email: string
  emailVerified?: boolean
  image: string | null
  role: Role
  actorKind: ActorKind
  actorName: string
  teams?: Record<string, TeamRole>
}

export const roleOf = (
  person: { email: string; emailVerified?: boolean | null },
  admins = useServerEnv().drop.admins.unseal(),
): Role => roleFor(person, admins, import.meta.dev === true || useServerEnv().drop.testSignin)

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

export function identify(event: H3Event): Promise<Identity | null> {
  return (event.context.dropIdentity ??= (
    event.context.dropPage ? identify(event.context.dropPage) : verify(event)
  ).then((who) => {
    if (who) logActor(event, who)
    return who
  }))
}

async function verify(event: H3Event): Promise<Identity | null> {
  const who = await resolveIdentity(event)
  if (!who) return null
  const [member, teams] = await Promise.all([isMember(who.userId, event), teamsOf(who.userId, event)])
  if (!member) {
    logDenied(event, "not-member")
    return null
  }
  who.teams = teams
  return who
}

async function resolveIdentity(event: H3Event): Promise<Identity | null> {
  const headers = event.res.headers
  const previousCookies = headers.getSetCookie()
  const result = await requireCaller(event)
    .catch((error: unknown) => {
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
    if (error.code === "AUTH_MCP_TOKEN_INVALID")
      requestLog(event)?.set({ mcp: { auth: { presented: true, result: "rejected", reason: mcpTokenReason(error) } } })
    if (error.code === "AUTH_SIGNED_OUT")
      requestLog(event)?.set({
        identity: { cookie: SESSION_COOKIE.test(event.req.headers.get("cookie") ?? "") ? "stale" : "absent" },
      })
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
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    role: roleOf(user),
    actorKind: caller.kind,
    actorName: caller.kind === "agent" ? (caller.client.name ?? "MCP client") : user.name,
  }
}

const SESSION_COOKIE = /(?:^|;)\s*[^=;\s]+\.session_token=[^;\s]/

const MCP_TOKEN_REASONS = [
  "expired",
  "malformed",
  "wrong_resource",
  "no_keys",
  "sender_constrained",
  "user_gone",
  "not_allowed",
  "client_disabled",
  "session_ended",
] as const

export type McpTokenReason = (typeof MCP_TOKEN_REASONS)[number] | "other"

export const MCP_TOKEN_MESSAGES: readonly (readonly [RegExp, McpTokenReason])[] = [
  [/"exp" claim timestamp check failed/, "expired"],
  [/is not a resource of `mcpOAuth\(\)`|unexpected "aud" claim value/, "wrong_resource"],
  [/the Auth has no signing keys/, "no_keys"],
  [/sender-constrained access tokens are not supported/, "sender_constrained"],
  [/the user does not exist or is banned/, "user_gone"],
  [/does not allow the user/, "not_allowed"],
  [/the OAuth client does not exist or is disabled/, "client_disabled"],
  [/the session does not exist or has expired/, "session_ended"],
  [
    /signature verification failed|Invalid Compact JWS|Invalid Token or Protected Header formatting|JWS Protected Header is invalid|unexpected "iss" claim value|"nbf" claim timestamp check failed|no applicable key found|the signature or a claim does not match/,
    "malformed",
  ],
]

const isMcpTokenReason = (value: unknown): value is McpTokenReason =>
  MCP_TOKEN_REASONS.some((reason) => reason === value)

export function mcpTokenReason(error: { message: string; data?: unknown }): McpTokenReason {
  const { data } = error
  if (typeof data === "object" && data !== null && "reason" in data && isMcpTokenReason(data.reason)) return data.reason
  return MCP_TOKEN_MESSAGES.find(([pattern]) => pattern.test(error.message))?.[1] ?? "other"
}

export async function identityOf(userId: string): Promise<Identity | null> {
  const [person] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!person || person.banned) return null
  const [member, teams] = await Promise.all([isMember(person.id), teamsOf(person.id)])
  if (!member) return null
  return {
    userId: person.id,
    name: person.name,
    email: person.email,
    emailVerified: person.emailVerified,
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
  throw authError("SIGN_IN_REQUIRED")
}

export async function requireAdmin(event: H3Event): Promise<Identity> {
  const who = await requireIdentity(event)
  if (who.role !== "admin" || who.actorKind !== "browser") throw authError("ADMIN_REQUIRED")
  return who
}
