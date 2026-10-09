import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { and, eq } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { account, user } from "../databases/config"
import { githubOrganization, isGitHubMember } from "./github-membership"

export const proxyAuthentication = process.env.DROP_AUTH_PROXY === "1"

/** Exchange oauth2-proxy's GitHub token for Drop's session. Header names alone prove nothing. */
export const proxyAuth = () => ({
  id: "drop-proxy",
  endpoints: {
    proxySignIn: createAuthEndpoint("/sign-in/proxy", { method: "POST", requireHeaders: true }, async (ctx) => {
      const token = ctx.headers?.get("x-auth-request-access-token")
      if (!proxyAuthentication || !githubOrganization || !await isGitHubMember(token))
        throw new APIError("UNAUTHORIZED", { message: "Active GitHub organization membership required." })
      const profile = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Quiver-Drop" },
        signal: AbortSignal.timeout(5000),
      }).then(response => response.ok ? response.json() as Promise<{ id: number; login: string; name?: string; avatar_url?: string }> : null).catch(() => null)
      if (!profile?.id || !profile.login) throw new APIError("UNAUTHORIZED", { message: "GitHub identity unavailable." })
      const accountId = String(profile.id)
      const [existing] = await db.select().from(account)
        .where(and(eq(account.providerId, "github"), eq(account.accountId, accountId))).limit(1)
      const userId = existing?.userId ?? `github-${accountId}`
      // A stable numeric GitHub ID avoids email-based linking and handles concurrent first requests.
      if (!existing) {
        await db.insert(user).values({
          id: userId, name: profile.name || profile.login, email: `${accountId}@users.noreply.github.com`,
          emailVerified: false, image: profile.avatar_url,
          role: (process.env.DROP_ADMINS ?? "").split(/[\s,]+/).includes(accountId) ? "admin" : "member",
        }).onConflictDoNothing()
        await db.insert(account).values({ id: `github-${accountId}`, userId, accountId, providerId: "github", accessToken: token }).onConflictDoNothing()
      }
      await db.update(account).set({ accessToken: token }).where(and(eq(account.userId, userId), eq(account.providerId, "github")))
      const member = await ctx.context.internalAdapter.findUserById(userId)
      if (!member || (member as { banned?: boolean }).banned) throw new APIError("FORBIDDEN", { message: "Account unavailable." })
      const session = await ctx.context.internalAdapter.createSession(userId)
      if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Session unavailable." })
      await setSessionCookie(ctx, { session, user: member })
      return ctx.json({ ok: true })
    }),
  },
})
