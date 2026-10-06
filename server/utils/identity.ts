import { eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { admin } from "better-auth/plugins"
import { getAuthForRequest } from "vite-hub/auth/server"
import { db } from "vite-hub/database/drizzle"
import { user as users } from "../databases/config"
import { isRole, type Role } from "#shared/roles"
import { ac, roles } from "./access"
import type { ActorKind } from "#shared/types"

/** Who is calling and how: a person in the browser, or an agent with an API key. */
export interface Identity {
  userId: string
  name: string
  email: string
  image: string | null
  role: Role
  actorKind: ActorKind
  /** Shown on drops: the key's name (often the agent, like "Claude Code") or the person's name. */
  actorName: string
}

export function apiKeyFrom(headers: Headers): string | null {
  const value = headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
  return value?.startsWith("drop_") ? value : null
}

// ViteHub's auth type doesn't know our plugins; this never runs, it only lends `authFor` the plugin endpoints' types.
function typedAuth() {
  return betterAuth({ plugins: [admin({ ac, roles }), apiKey()] })
}

export const authFor = (event: H3Event) => getAuthForRequest(event.req, undefined, event) as unknown as ReturnType<typeof typedAuth>

/** Who is calling. Resolved once per request (middleware and route share it). */
export function identify(event: H3Event): Promise<Identity | null> {
  const context = event.context as { dropIdentity?: Promise<Identity | null> }
  return (context.dropIdentity ??= resolveIdentity(event))
}

async function resolveIdentity(event: H3Event): Promise<Identity | null> {
  const auth = authFor(event)
  const key = apiKeyFrom(event.req.headers)
  if (key) {
    const result = await auth.api.verifyApiKey({ body: { key } }).catch(() => null)
    if (!result?.valid || !result.key) return null
    const [user] = await db.select().from(users).where(eq(users.id, result.key.referenceId)).limit(1)
    if (!user || user.banned) return null
    return {
      userId: user.id, name: user.name, email: user.email, image: user.image ?? null,
      role: isRole(user.role ?? "") ? user.role as Role : "member",
      actorKind: "key",
      actorName: result.key.name || "API key",
    }
  }
  const session = await auth.api.getSession({ headers: event.req.headers }).catch(() => null)
  if (!session?.user) return null
  const role = (session.user as { role?: string }).role ?? "member"
  return {
    userId: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null,
    role: isRole(role) ? role : "member",
    actorKind: "browser",
    actorName: session.user.name,
  }
}

export async function requireIdentity(event: H3Event): Promise<Identity> {
  const who = await identify(event)
  if (who) return who
  event.res.headers.set("WWW-Authenticate", 'Bearer realm="drop"')
  throw new HTTPError({
    status: 401,
    statusText: "Sign in, or send an API key: create one at /agents and pass it as `x-api-key: drop_…`.",
  })
}

export async function requireAdmin(event: H3Event): Promise<Identity> {
  const who = await requireIdentity(event)
  if (who.role !== "admin") throw new HTTPError({ status: 403, statusText: "Only admins can do that." })
  return who
}
