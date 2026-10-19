import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { and, eq } from "drizzle-orm"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { account, user } from "../databases/config"
import { isGitHubMember } from "./github-membership"
import { readAuthProxyConfig } from "./proxy-auth-config"
import { roleOf } from "./identity"
export const authProxy = readAuthProxyConfig

// The fields Drop reads from GitHub's REST API. GitHub sends null for a name or email the person keeps private.
const GitHubUser = v.object({
  id: v.number(),
  login: v.string(),
  name: v.nullish(v.string()),
  email: v.nullish(v.string()),
  avatar_url: v.optional(v.string()),
})
const GitHubEmails = v.array(v.object({ email: v.string(), primary: v.boolean(), verified: v.boolean() }))
const Banned = v.object({ banned: v.literal(true) })

/** Exchange oauth2-proxy's GitHub token for Drop's session. Header names alone prove nothing. */
export const proxyAuth = () => ({
  id: "drop-proxy",
  endpoints: {
    proxySignIn: createAuthEndpoint("/sign-in/proxy", { method: "POST", requireHeaders: true }, async (ctx) => {
      const token = ctx.headers?.get("x-auth-request-access-token")
      if (!token || !authProxy().enabled || !(await isGitHubMember(token)))
        throw new APIError("UNAUTHORIZED", { message: "Active GitHub organization membership required." })
      const profile = await githubApi(GitHubUser, "user", token)
      if (!profile?.id || !profile.login)
        throw new APIError("UNAUTHORIZED", { message: "GitHub identity unavailable." })
      const accountId = String(profile.id)
      const placeholder = `${accountId}@users.noreply.github.com`
      // Like Better Auth's GitHub provider: the public profile email, else the primary one (oauth2-proxy asks for
      // `user:email`). The placeholder stays only when GitHub shares neither.
      const emails = await githubApi(GitHubEmails, "user/emails", token)
      const email = profile.email || (emails?.find((entry) => entry.primary) ?? emails?.[0])?.email || placeholder
      // GitHub vouches for an address it verified; a public profile email alone proves nothing (DROP_ADMINS trusts it).
      const emailVerified = Boolean(
        emails?.find((entry) => entry.email.toLowerCase() === email.toLowerCase())?.verified,
      )
      const [existing] = await db
        .select()
        .from(account)
        .where(and(eq(account.providerId, "github"), eq(account.accountId, accountId)))
        .limit(1)
      const userId = existing?.userId ?? `github-${accountId}`
      // A stable numeric GitHub ID avoids email-based linking and handles concurrent first requests.
      if (!existing) {
        const role = roleOf({ email, emailVerified })
        const fields = { id: userId, name: profile.name || profile.login, image: profile.avatar_url, role }
        const [created] = await db
          .insert(user)
          .values({ ...fields, email, emailVerified })
          .onConflictDoNothing()
          .returning({ id: user.id })
        // Another account may hold that email already: join under the placeholder instead.
        if (!created && email !== placeholder)
          await db
            .insert(user)
            .values({ ...fields, email: placeholder, emailVerified: false })
            .onConflictDoNothing()
        await db
          .insert(account)
          .values({ id: `github-${accountId}`, userId, accountId, providerId: "github", accessToken: token })
          .onConflictDoNothing()
      }
      await db
        .update(account)
        .set({ accessToken: token })
        .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
      // People who joined before Drop asked GitHub get their real email now. Another account holding it keeps it.
      if (existing && email !== placeholder)
        await db
          .update(user)
          .set({ email, emailVerified })
          .where(and(eq(user.id, userId), eq(user.email, placeholder)))
          .catch(() => {})
      if (emailVerified)
        await db
          .update(user)
          .set({ emailVerified })
          .where(and(eq(user.id, userId), eq(user.email, email)))
          .catch(() => {})
      const member = await ctx.context.internalAdapter.findUserById(userId)
      if (!member || v.is(Banned, member)) throw new APIError("FORBIDDEN", { message: "Account unavailable." })
      const session = await ctx.context.internalAdapter.createSession(userId)
      if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Session unavailable." })
      await setSessionCookie(ctx, { session, user: member })
      return ctx.json({ ok: true })
    }),
  },
})

async function githubApi<T extends v.GenericSchema>(
  schema: T,
  path: string,
  token: string,
): Promise<v.InferOutput<T> | null> {
  const body: unknown = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
  const parsed = v.safeParse(schema, body)
  return parsed.success ? parsed.output : null
}
