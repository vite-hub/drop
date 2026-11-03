import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { handleOAuthUserInfo } from "better-auth/oauth2"
import { HTTPError } from "h3"
import * as v from "valibot"
import { isGitHubMember } from "./github-membership"
import { readAuthProxyConfig } from "./proxy-auth-config"
export const authProxy = readAuthProxyConfig

const signIns = new Map<string, Promise<void>>()

const GitHubIdentity = v.object({
  id: v.number(),
  login: v.string(),
  name: v.nullish(v.string()),
  email: v.nullish(v.string()),
  avatar_url: v.nullish(v.string()),
})
const GitHubEmails = v.array(v.object({ email: v.string(), primary: v.boolean(), verified: v.boolean() }))

/** Exchange oauth2-proxy's GitHub token for Drop's session. Header names alone prove nothing. */
export const proxyAuth = () => ({
  id: "drop-proxy",
  endpoints: {
    proxySignIn: createAuthEndpoint("/sign-in/proxy", { method: "POST", requireHeaders: true }, async (ctx) => {
      const token = ctx.headers?.get("x-auth-request-access-token")
      if (!token || !authProxy().enabled)
        throw new APIError("UNAUTHORIZED", { message: "GitHub proxy sign-in is unavailable." })
      try {
        if (!(await isGitHubMember(token)))
          throw new APIError("FORBIDDEN", { message: "Active GitHub organization membership required." })
      } catch (error) {
        if (!(error instanceof HTTPError)) throw error
        throw new APIError(
          error.status === 401 ? "UNAUTHORIZED" : error.status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE",
          {
            message: error.message,
          },
        )
      }
      // Better Auth's GitHub getUserInfo erases HTTP errors, including a revoked token after membership was cached.
      const identity = v.safeParse(GitHubIdentity, await githubApi("user", token))
      if (!identity.success)
        throw new APIError("SERVICE_UNAVAILABLE", { message: "GitHub identity is unavailable. Try again shortly." })
      const accountId = String(identity.output.id)
      const profile = identity.output
      const emails = v.safeParse(GitHubEmails, await githubApi("user/emails", token))
      const addresses = emails.success ? emails.output : []
      const email =
        profile.email ||
        (addresses.find((entry) => entry.primary) ?? addresses[0])?.email ||
        `${accountId}@users.noreply.github.com`
      // Parallel proxy requests must finish provisioning the GitHub account before another sign-in reads it.
      const key = `${ctx.context.baseURL}:${accountId}`
      const previous = signIns.get(key)
      const finished = Promise.withResolvers<void>()
      signIns.set(key, finished.promise)
      await previous
      try {
        const { data, error } = await handleOAuthUserInfo(ctx, {
          userInfo: {
            id: accountId,
            name: profile.name || profile.login,
            email,
            image: profile.avatar_url ?? undefined,
            emailVerified: addresses.find((entry) => entry.email === email)?.verified ?? false,
          },
          account: { providerId: "github", accountId, accessToken: token },
          overrideUserInfo: true,
        })
        if (error || !data)
          throw new APIError("FORBIDDEN", { message: "GitHub sign-in could not create an authorized account." })
        await setSessionCookie(ctx, data)
      } finally {
        finished.resolve()
        if (signIns.get(key) === finished.promise) signIns.delete(key)
      }
      return ctx.json({ ok: true })
    }),
  },
})

/** Keep GitHub's credential failures distinct from unavailable or malformed profile data. */
async function githubApi(path: string, token: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  if (response?.status === 401)
    throw new APIError("UNAUTHORIZED", { message: "GitHub sign-in expired or was revoked. Sign in again to Drop." })
  if (!response?.ok) return null
  return response.json().catch(() => null)
}
