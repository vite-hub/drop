import { APIError } from "better-auth/api"
import { and, eq } from "drizzle-orm"
import { HTTPError } from "h3"
import * as v from "valibot"
import { type ForwardedIdentity, forwardAuth } from "vite-hub/auth/forward"
import { db } from "vite-hub/database"
import { account } from "../databases/default/index"
import { authApiError, isAuthErrorCode } from "./auth-errors"
import { authRequest, requestLog } from "./logs"
import { isProxyMember, readAuthProxyConfig } from "./proxy-auth-config"

export const PROXY_TOKEN_HEADER = "x-auth-request-access-token"
export const authProxy = readAuthProxyConfig

const IDENTITY_TTL_MS = 300_000
const identities = new Map<string, { identity: ForwardedIdentity; expiresAt: number }>()
const signIns = new Map<string, Promise<void>>()
const tokenSignIns = new Map<string, Promise<unknown>>()

const GitHubIdentity = v.object({
  id: v.number(),
  login: v.string(),
  name: v.nullish(v.string()),
  email: v.nullish(v.string()),
  avatar_url: v.nullish(v.string()),
})
const Coded = v.object({ code: v.string() })
const GitHubEmails = v.array(v.object({ email: v.string(), primary: v.boolean(), verified: v.boolean() }))

export const proxyAuth = () =>
  forwardAuth({
    header: PROXY_TOKEN_HEADER,
    async verify({ value: token }) {
      if (!authProxy().enabled) return null
      try {
        if (!(await isProxyMember(token))) return null
      } catch (error) {
        if (!(error instanceof HTTPError)) throw error
        const code = v.is(Coded, error.data) ? error.data.code : undefined
        if (isAuthErrorCode(code)) throw authApiError(code)
        throw new APIError(
          error.status === 401 ? "UNAUTHORIZED" : error.status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE",
          { message: error.message, code },
        )
      }
      const identity = await cachedIdentity(token)
      const stored = await storedAccount(identity)
      return stored?.accessToken === token ? identity : { ...identity, accessToken: token }
    },
  })

async function storedAccount({ providerId, accountId }: ForwardedIdentity) {
  const [stored] = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.providerId, providerId), eq(account.accountId, accountId)))
    .limit(1)
  return stored
}

export async function oneSignInAtATime<T>(token: string, signIn: () => Promise<T>): Promise<T> {
  const key = await tokenKey(token)
  const running = tokenSignIns.get(key)
  // SAFETY: the proxy-session middleware is the one caller, so a running sign-in for a token resolves to its own result type.
  if (running) return running as Promise<T>
  const run = oneSignInPerIdentity(token, signIn)
  tokenSignIns.set(key, run)
  try {
    return await run
  } finally {
    if (tokenSignIns.get(key) === run) tokenSignIns.delete(key)
  }
}

export async function oneSignInPerIdentity<T>(token: string, signIn: () => Promise<T>): Promise<T> {
  const identity = await cachedIdentity(token)
  if (await storedAccount(identity)) return signIn()
  const key = `${identity.providerId}\n${identity.accountId}`
  const previous = signIns.get(key)
  let release: (() => void) | undefined
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  signIns.set(key, turn)
  await previous
  try {
    return await signIn()
  } finally {
    release?.()
    if (signIns.get(key) === turn) signIns.delete(key)
  }
}

async function tokenKey(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function cachedIdentity(token: string): Promise<ForwardedIdentity> {
  const cached = identities.get(token)
  if (cached && cached.expiresAt > Date.now()) return cached.identity
  const identity = await githubIdentity(token)
  const now = Date.now()
  for (const [entry, stored] of identities) if (stored.expiresAt <= now) identities.delete(entry)
  identities.set(token, { identity, expiresAt: now + IDENTITY_TTL_MS })
  return identity
}

async function githubIdentity(token: string): Promise<ForwardedIdentity> {
  const profile = v.safeParse(GitHubIdentity, await githubApi("user", token))
  if (!profile.success) throw authApiError("GITHUB_IDENTITY_UNAVAILABLE")
  const { id, login, name, avatar_url: image } = profile.output
  const accountId = String(id)
  const emails = v.safeParse(GitHubEmails, await githubApi("user/emails", token))
  const addresses = emails.success ? emails.output : []
  const email =
    profile.output.email ||
    (addresses.find((entry) => entry.primary) ?? addresses[0])?.email ||
    `${accountId}@users.noreply.github.com`
  return {
    providerId: "github",
    accountId,
    name: name || login,
    email,
    image: image ?? null,
    emailVerified: addresses.find((entry) => entry.email === email)?.verified ?? false,
  }
}

async function githubApi(path: string, token: string): Promise<unknown> {
  const failed = (reason: unknown) => {
    requestLog(authRequest.getStore())?.warn("GitHub API call failed", {
      github: { path, failure: reason instanceof Error ? reason.message : String(reason) },
    })
    return null
  }
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  }).catch(failed)
  if (response?.status === 401) throw authApiError("GITHUB_REAUTH_REQUIRED")
  if (!response) return null
  if (!response.ok) return failed(`HTTP ${response.status}`)
  return response.json().catch(failed)
}
