import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { and, eq } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { account, user } from "../databases/config"
import { githubOrganization, isGitHubMember } from "./github-membership"

/** Whether people sign in through an existing GitHub oauth2-proxy (`DROP_AUTH_PROXY`), and its cookie to clear on logout. */
export function authProxy() {
  const { authProxy: enabled, authProxyCookie } = useServerEnv().drop
  const cookie = authProxyCookie.trim() || null
  if (enabled && !githubOrganization()) throw new Error("DROP_AUTH_PROXY requires DROP_GITHUB_ORG.")
  if (cookie && !/^[A-Za-z0-9_-]+$/.test(cookie)) throw new Error("DROP_AUTH_PROXY_COOKIE must be a cookie name.")
  return { enabled, cookie }
}

/** Exchange oauth2-proxy's GitHub token for Drop's session. Header names alone prove nothing. */
export const proxyAuth = () => ({
  id: "drop-proxy",
  endpoints: {
    proxySignIn: createAuthEndpoint("/sign-in/proxy", { method: "POST", requireHeaders: true }, async (ctx) => {
      const token = ctx.headers?.get("x-auth-request-access-token")
      if (!token || !authProxy().enabled || !await isGitHubMember(token))
        throw new APIError("UNAUTHORIZED", { message: "Active GitHub organization membership required." })
      const profile = await githubApi<{ id: number; login: string; name?: string; email?: string | null; avatar_url?: string }>("user", token)
      if (!profile?.id || !profile.login) throw new APIError("UNAUTHORIZED", { message: "GitHub identity unavailable." })
      const accountId = String(profile.id)
      const placeholder = `${accountId}@users.noreply.github.com`
      // Like Better Auth's GitHub provider: the public profile email, else the primary one (oauth2-proxy asks for
      // `user:email`). The placeholder stays only when GitHub shares neither.
      const emails = profile.email ? null : await githubApi<{ email: string; primary: boolean; verified: boolean }[]>("user/emails", token)
      const email = profile.email || (emails?.find(entry => entry.primary) ?? emails?.[0])?.email || placeholder
      const emailVerified = profile.email ? false : Boolean(emails?.find(entry => entry.email === email)?.verified)
      const [existing] = await db.select().from(account)
        .where(and(eq(account.providerId, "github"), eq(account.accountId, accountId))).limit(1)
      const userId = existing?.userId ?? `github-${accountId}`
      // A stable numeric GitHub ID avoids email-based linking and handles concurrent first requests.
      if (!existing) {
        const role = useServerEnv().drop.admins.unseal().split(/[\s,]+/).includes(accountId) ? "admin" : "member"
        const fields = { id: userId, name: profile.name || profile.login, image: profile.avatar_url, role }
        const [created] = await db.insert(user).values({ ...fields, email, emailVerified }).onConflictDoNothing().returning({ id: user.id })
        // Another account may hold that email already: join under the placeholder instead.
        if (!created && email !== placeholder) await db.insert(user).values({ ...fields, email: placeholder, emailVerified: false }).onConflictDoNothing()
        await db.insert(account).values({ id: `github-${accountId}`, userId, accountId, providerId: "github", accessToken: token }).onConflictDoNothing()
      }
      await db.update(account).set({ accessToken: token }).where(and(eq(account.userId, userId), eq(account.providerId, "github")))
      // People who joined before Drop asked GitHub get their real email now. Another account holding it keeps it.
      if (existing && email !== placeholder)
        await db.update(user).set({ email, emailVerified }).where(and(eq(user.id, userId), eq(user.email, placeholder))).catch(() => {})
      const member = await ctx.context.internalAdapter.findUserById(userId)
      if (!member || (member as { banned?: boolean }).banned) throw new APIError("FORBIDDEN", { message: "Account unavailable." })
      const session = await ctx.context.internalAdapter.createSession(userId)
      if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Session unavailable." })
      await setSessionCookie(ctx, { session, user: member })
      return ctx.json({ ok: true })
    }),
  },
})

async function githubApi<T>(path: string, token: string): Promise<T | null> {
  return fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  }).then(response => (response.ok ? response.json() as Promise<T> : null)).catch(() => null)
}
