import { oauthProvider } from "@better-auth/oauth-provider"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { github } from "better-auth/social-providers"
import { admin, jwt } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import { defineAuth } from "vite-hub/auth"
import { db, schema } from "vite-hub/database/drizzle"
import type { ServerEnv } from "#vitehub/env/server"
import { user as users } from "./databases/config"
import { ac, roles } from "./utils/access"
import { nativeClientRegistration } from "./utils/oauth-clients"
import { githubOrganization, isGitHubMember } from "./utils/github-membership"
import { proxyAuth, proxyAuthentication } from "./utils/proxy-auth"

/**
 * Who can sign in, and how.
 *
 * Drop signs in with GitHub. To use another provider, swap `socialProviders` (Google, GitLab, Discord…),
 * or add `emailAndPassword: { enabled: true }`, then set its secrets in nuxt.config.ts `vite.env.server.auth`.
 *
 * Anyone with a GitHub account can sign in and joins as a member: their drops are private to them until they
 * share them. The GitHub users listed in `DROP_ADMINS` (numeric ids, from `gh api users/<login> --jq .id`) become
 * admins when their account is created; admins can make anyone else an editor or an admin on the Members page.
 *
 * Agents have no keys. Drop is an OAuth 2.1 authorization server for its own MCP endpoint (`oauthProvider`):
 * an MCP client registers itself, opens the browser once, and the person approves it on /oauth (signing in
 * with GitHub first if needed). The client keeps the token; `jwt` signs it, scoped to `<origin>/mcp`.
 * `/token` is the JWT plugin's session-to-JWT endpoint, which agents don't need.
 *
 * Local dev has no GitHub OAuth app, so email and password sign-in is on in `nuxt dev` only.
 *
 */
export default defineAuth(({ env: runtimeEnv, requestOrigin }) => {
  const env = runtimeEnv as unknown as ServerEnv
  const githubOptions = {
    clientId: proxyAuthentication ? "" : env.auth.github.clientId.unseal(), clientSecret: proxyAuthentication ? "" : env.auth.github.clientSecret.unseal(),
    scope: githubOrganization ? ["read:org"] : undefined,
  }
  return {
    appName: "Drop",
    baseURL: requestOrigin,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.auth.secret.unseal(),
    route: false,
    disabledPaths: ["/token", ...(proxyAuthentication ? ["/sign-in/social", "/callback/github", "/link-social"] : [])],
    access: { signIn: { callbackURL: "/drops", errorCallbackURL: "/?auth_error=1", provider: "github" } },
    socialProviders: proxyAuthentication ? {} : {
      github: {
        ...githubOptions,
        ...(githubOrganization ? { getUserInfo: async (token: Parameters<ReturnType<typeof github>["getUserInfo"]>[0]) =>
          await isGitHubMember(token.accessToken) ? github(githubOptions).getUserInfo(token) : null } : {}),
      },
    },
    emailAndPassword: { enabled: import.meta.dev === true || process.env.DROP_TEST_SIGNIN === "1" },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
    hooks: { before: nativeClientRegistration },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            if (account.providerId !== "github") return
            // Public GitHub metadata is a review signal; a lookup failure never blocks private use.
            const profile = await fetch(`https://api.github.com/user/${encodeURIComponent(account.accountId)}`, {
              headers: { "User-Agent": "Drop", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(3000),
            }).then(response => response.ok ? response.json() as Promise<{ created_at?: string }> : null).catch(() => null)
            const githubCreatedAt = profile?.created_at ? Date.parse(profile.created_at) : NaN
            if (Number.isFinite(githubCreatedAt)) await db.update(users).set({ githubCreatedAt }).where(eq(users.id, account.userId))
            const admins = env.drop.admins.unseal().split(/[\s,]+/).filter(Boolean)
            if (admins.includes(account.accountId)) await db.update(users).set({ role: "admin" }).where(eq(users.id, account.userId))
          },
        },
      },
    },
    plugins: [
      proxyAuth(),
      admin({ ac, roles, defaultRole: "member", adminRoles: ["admin"] }),
      jwt(),
      oauthProvider({
        loginPage: "/oauth",
        consentPage: "/oauth",
        scopes: ["openid", "profile", "email", "offline_access"],
        resources: [`${requestOrigin}/mcp`],
        enforcePerClientResources: false,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
  }
})
