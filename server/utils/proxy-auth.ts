import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { handleOAuthUserInfo } from "better-auth/oauth2"
import { github } from "better-auth/social-providers"
import { HTTPError } from "h3"
import * as v from "valibot"
import { isGitHubMember } from "./github-membership"
import { readAuthProxyConfig } from "./proxy-auth-config"
export const authProxy = readAuthProxyConfig

const signIns = new Map<string, Promise<void>>()

const GitHubIdentity = v.object({ id: v.number(), login: v.string() })

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
      // The proxy already exchanged the authorization code. Better Auth only needs its access token here.
      const profile = await github({ clientId: "", clientSecret: "" })
        .getUserInfo({ accessToken: token })
        .catch(() => null)
      const identity = v.safeParse(GitHubIdentity, profile?.data)
      if (!profile || !identity.success)
        throw new APIError("SERVICE_UNAVAILABLE", { message: "GitHub identity is unavailable. Try again shortly." })
      const accountId = String(identity.output.id)
      // Parallel proxy requests must finish provisioning the GitHub account before another sign-in reads it.
      const key = `${ctx.context.baseURL}:${accountId}`
      const previous = signIns.get(key)
      const finished = Promise.withResolvers<void>()
      signIns.set(key, finished.promise)
      await previous
      try {
        const { data, error } = await handleOAuthUserInfo(ctx, {
          userInfo: {
            ...profile.user,
            id: accountId,
            name: profile.user.name || identity.output.login,
            email: profile.user.email || `${accountId}@users.noreply.github.com`,
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
