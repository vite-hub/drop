import { and, eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import type { Auth } from "better-auth"
import { useLogger } from "evlog/nitro/v3"
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"
import { getAuthForRequest } from "vite-hub/auth/server"
import { db } from "vite-hub/database/drizzle"
import { account, oauthClient, user as users } from "../databases/config"
import { githubOrganization, isGitHubMember } from "./github-membership"
import { useServerEnv } from "#vitehub/env/server"
import { type Role, roleFor } from "#shared/roles"
import type { ActorKind } from "#shared/types"
import { textValue } from "#shared/utils/text"
import type auth from "../auth"

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

type DropAuth = Auth<ReturnType<typeof auth.options>>

/**
 * Someone's role, from `DROP_ADMINS`: an admin when their email is in it and a sign-in method verified it, whichever one
 * (GitHub, another provider, email). Everyone else is a member. Outside `nuxt dev` and the runtime tests an unverified
 * email never counts, so nobody becomes an admin by typing someone else's address.
 */
export const roleOf = (person: { email: string; emailVerified?: boolean | null }, admins = useServerEnv().drop.admins.unseal()): Role =>
  roleFor(person, admins, import.meta.dev === true || useServerEnv().drop.testSignin)

/**
 * Writes the role `DROP_ADMINS` gives someone to their account, for Better Auth's admin endpoints (bans) that read it from
 * there. Drop itself reads `roleOf` on every request, so a change to `DROP_ADMINS` takes effect on restart either way.
 */
export async function syncRole(userId: string) {
  const [row] = await db.select({ email: users.email, emailVerified: users.emailVerified, role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (row && row.role !== roleOf(row)) await db.update(users).set({ role: roleOf(row) }).where(eq(users.id, userId))
}

// SAFETY: ViteHub builds this instance from server/auth.ts's definition, the one DropAuth is the type of. Its own type is
// the plain Better Auth instance, without the plugins' endpoints and fields, which no single assertion bridges.
// doctor-disable-next-line typescript/evidence/no-chained-type-assertions -- getAuthForRequest's type isn't generic over the definition
export const authFor = (event: H3Event) => getAuthForRequest(event.req, undefined, event) as unknown as DropAuth

export const bearerFrom = (headers: Headers) => headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null

/** Who is calling. Resolved once per request (middleware and route share it). */
export function identify(event: H3Event): Promise<Identity | null> {
  return (event.context.dropIdentity ??= resolveIdentity(event).then(async (who) => {
    if (who && githubOrganization()) {
      const [githubAccount] = await db.select({ token: account.accessToken }).from(account)
        .where(and(eq(account.userId, who.userId), eq(account.providerId, "github"))).limit(1)
      if (!await isGitHubMember(githubAccount?.token)) return null
    }
    // Every request's wide event says who made it, never the credential itself.
    if (who) useLogger(event).set({ user: { id: who.userId, role: who.role }, actor: { kind: who.actorKind, name: who.actorName } })
    return who
  }))
}

async function resolveIdentity(event: H3Event): Promise<Identity | null> {
  const token = bearerFrom(event.req.headers)
  if (token) return fromAccessToken(event, token)
  const session = await authFor(event).api.getSession({ headers: event.req.headers }).catch(() => null)
  if (!session?.user || session.user.banned) return null
  return {
    userId: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null,
    role: roleOf(session.user),
    actorKind: "browser",
    actorName: session.user.name,
  }
}

// Drop's own signing keys, read in-process instead of over HTTP (a Worker fetching its own hostname is a loop).
// Kept for a few minutes per isolate; a token signed by a newer key forces a reload.
let signingKeys: { at: number; keys: Promise<JSONWebKeySet> } | undefined
function jwksFor(event: H3Event, fresh = false) {
  if (fresh || !signingKeys || Date.now() - signingKeys.at > 300_000)
    signingKeys = { at: Date.now(), keys: authFor(event).api.getJwks() }
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
  const clientId = textValue(payload.azp) ?? textValue(payload.client_id) ?? null
  const [client] = clientId ? await db.select({ name: oauthClient.name }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1) : []
  return {
    userId: user.id, name: user.name, email: user.email, image: user.image ?? null,
    role: roleOf(user),
    actorKind: "agent",
    actorName: client?.name || "MCP client",
  }
}

export async function requireIdentity(event: H3Event): Promise<Identity> {
  const who = await identify(event)
  if (who) return who
  event.res.headers.set("WWW-Authenticate", "Bearer realm=\"drop\"")
  throw new HTTPError({ status: 401, statusText: "Sign in, or connect your agent through Drop's MCP server." })
}

/**
 * An admin, in the browser. An agent an admin connected is not enough: what it reads (a guest's comment, say) can
 * steer it, so it never approves shares, reads reports, quarantines, or changes members and skills.
 */
export async function requireAdmin(event: H3Event): Promise<Identity> {
  const who = await requireIdentity(event)
  if (who.role !== "admin" || who.actorKind !== "browser") throw new HTTPError({ status: 403, statusText: "Only admins, in the browser, can do that." })
  return who
}
