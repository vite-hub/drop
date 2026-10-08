import { eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { admin, jwt } from "better-auth/plugins"
import { useLogger } from "evlog/nitro/v3"
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"
import { getAuthForRequest } from "vite-hub/auth/server"
import { db } from "vite-hub/database/drizzle"
import { oauthClient, user as users } from "../databases/config"
import { isRole, type Role } from "#shared/roles"
import { ac, roles } from "./access"
import type { ActorKind } from "#shared/types"

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
}

// ViteHub's auth type doesn't know our plugins; this never runs, it only lends `authFor` the plugin endpoints' types.
function typedAuth() {
  return betterAuth({ plugins: [admin({ ac, roles }), jwt(), oauthProvider({ loginPage: "/oauth", consentPage: "/oauth" })] })
}

export const authFor = (event: H3Event) => getAuthForRequest(event.req, undefined, event) as unknown as ReturnType<typeof typedAuth>

export const bearerFrom = (headers: Headers) => headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null

/** Who is calling. Resolved once per request (middleware and route share it). */
export function identify(event: H3Event): Promise<Identity | null> {
  const context = event.context as { dropIdentity?: Promise<Identity | null> }
  return (context.dropIdentity ??= resolveIdentity(event).then((who) => {
    // Every request's wide event says who made it, never the credential itself.
    if (who) useLogger(event).set({ user: { id: who.userId, role: who.role }, actor: { kind: who.actorKind, name: who.actorName } })
    return who
  }))
}

async function resolveIdentity(event: H3Event): Promise<Identity | null> {
  const token = bearerFrom(event.req.headers)
  if (token) return fromAccessToken(event, token)
  const session = await authFor(event).api.getSession({ headers: event.req.headers }).catch(() => null)
  if (!session?.user || (session.user as { banned?: boolean }).banned) return null
  const role = (session.user as { role?: string }).role ?? "member"
  return {
    userId: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null,
    role: isRole(role) ? role : "member",
    actorKind: "browser",
    actorName: session.user.name,
  }
}

// Drop's own signing keys, read in-process instead of over HTTP (a Worker fetching its own hostname is a loop).
// Kept for a few minutes per isolate; a token signed by a newer key forces a reload.
let signingKeys: { at: number; keys: Promise<JSONWebKeySet> } | undefined
function jwksFor(event: H3Event, fresh = false) {
  if (fresh || !signingKeys || Date.now() - signingKeys.at > 300_000)
    signingKeys = { at: Date.now(), keys: authFor(event).api.getJwks() as Promise<JSONWebKeySet> }
  return signingKeys.keys
}

/** An MCP client's OAuth access token: a JWT this Drop issued, for this Drop's `/mcp`. */
async function fromAccessToken(event: H3Event, token: string): Promise<Identity | null> {
  const origin = event.url.origin
  const verify = async (fresh: boolean) => jwtVerify(token, createLocalJWKSet(await jwksFor(event, fresh)), { issuer: `${origin}/api/auth`, audience: `${origin}/mcp` })
  const verified = await verify(false).catch(error => (error?.code === "ERR_JWKS_NO_MATCHING_KEY" ? verify(true) : null)).catch(() => null)
  const payload = verified?.payload
  if (!payload?.sub) return null
  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
  if (!user || user.banned) return null
  const clientId = typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : null
  const [client] = clientId ? await db.select({ name: oauthClient.name }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1) : []
  return {
    userId: user.id, name: user.name, email: user.email, image: user.image ?? null,
    role: isRole(user.role ?? "") ? user.role as Role : "member",
    actorKind: "agent",
    actorName: client?.name || "MCP client",
  }
}

export async function requireIdentity(event: H3Event): Promise<Identity> {
  const who = await identify(event)
  if (who) return who
  event.res.headers.set("WWW-Authenticate", 'Bearer realm="drop"')
  throw new HTTPError({ status: 401, statusText: "Sign in with GitHub, or connect your agent through Drop's MCP server." })
}

export async function requireAdmin(event: H3Event): Promise<Identity> {
  const who = await requireIdentity(event)
  if (who.role !== "admin") throw new HTTPError({ status: 403, statusText: "Only admins can do that." })
  return who
}
