import { oauthProvider } from "@better-auth/oauth-provider"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { github } from "better-auth/social-providers"
import { admin, jwt } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import * as v from "valibot"
import { defineAuth } from "vite-hub/auth"
import { db, schema } from "vite-hub/database/drizzle"
import { user as users } from "./databases/config"
import { ac, roles } from "./utils/access"
import { clientRegistrationLimits } from "./utils/oauth-clients"
import { isGitHubMember } from "./utils/github-membership"
import { isListedMember } from "./utils/members"
import { roleOf, syncRole } from "./utils/identity"
import { authProxy, proxyAuth } from "./utils/proxy-auth"

// The account's creation date, a review signal (shared/trust.ts).
const GitHubProfile = v.object({ created_at: v.optional(v.string()) })

// Kept out of `defineAuth()`: ViteHub's auth scanner takes minutes on generic type arguments inside it.
type GitHubToken = Parameters<ReturnType<typeof github>["getUserInfo"]>[0]

/**
 * Who can sign in, and how.
 *
 * Drop signs in with GitHub. To use another provider, swap `socialProviders` (Google, GitLab, Discord…),
 * or add `emailAndPassword: { enabled: true }`, then set its secrets in nuxt.config.ts `vite.env.server.auth`.
 *
 * Anyone with a GitHub account can sign in and joins as a member. `DROP_MEMBERS`, when set, lists by email the only
 * people who may (admins always may); `DROP_GITHUB_ORG` limits it to an organization. `DROP_ADMINS` lists the admins
 * by email. Whoever signs in with one of those emails, verified by the sign-in method, is a member or an admin, so
 * swapping GitHub for another provider keeps both lists. `roleOf` decides on every request; each new session writes
 * it down for Better Auth's admin endpoints. Nobody else changes roles, so the admin plugin's set-role is off, and so is
 * its impersonation, which Drop doesn't offer.
 *
 * Agents have no keys. Drop is an OAuth 2.1 authorization server for its own MCP endpoint (`oauthProvider`):
 * an MCP client registers itself, opens the browser once, and the person approves it on /oauth (signing in
 * with GitHub first if needed). The client keeps the token; `jwt` signs it, scoped to `<origin>/mcp`.
 * `/token` is the JWT plugin's session-to-JWT endpoint, which agents don't need.
 *
 * Local dev has no GitHub OAuth app, so email and password sign-in is on in `nuxt dev` only.
 *
 */
export default defineAuth(({ env, requestOrigin }) => {
  const proxied = authProxy().enabled
  const organization = env.drop.githubOrg.trim()
  const githubOptions = {
    clientId: proxied ? "" : env.auth.github.clientId.unseal(),
    clientSecret: proxied ? "" : env.auth.github.clientSecret.unseal(),
    scope: organization ? ["read:org"] : undefined,
  }
  return {
    appName: "Drop",
    baseURL: requestOrigin,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.auth.secret.unseal(),
    route: false,
    // `__Host-` cookies can't be set or replaced from another subdomain, such as the content origin where drops run
    // their own scripts. Better Auth would prefix `__Secure-`, which a subdomain can still overwrite.
    advanced: requestOrigin.startsWith("https://")
      ? { useSecureCookies: false, cookiePrefix: "__Host-drop", defaultCookieAttributes: { secure: true } }
      : {},
    disabledPaths: [
      "/token",
      "/admin/set-role",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      ...(proxied ? ["/sign-in/social", "/callback/github", "/link-social"] : []),
    ],
    access: { signIn: { callbackURL: "/drops", errorCallbackURL: "/?auth_error=1", provider: "github" } },
    socialProviders: proxied
      ? {}
      : {
          github: {
            ...githubOptions,
            ...(organization
              ? {
                  getUserInfo: async (token: GitHubToken) =>
                    (await isGitHubMember(token.accessToken)) ? github(githubOptions).getUserInfo(token) : null,
                }
              : {}),
          },
        },
    emailAndPassword: { enabled: import.meta.dev === true || env.drop.testSignin },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
    // Free or Pro (shared/quotas.ts TIERS). Only admins set it, from the Members page through the admin plugin.
    user: { additionalFields: { plan: { type: ["free", "pro"], required: false, input: false } } },
    hooks: { before: clientRegistrationLimits },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            if (account.providerId !== "github") return
            // Public GitHub metadata is a review signal; a lookup failure never blocks private use.
            const profile = await fetch(`https://api.github.com/user/${encodeURIComponent(account.accountId)}`, {
              headers: { "User-Agent": "Drop", Accept: "application/vnd.github+json" },
              signal: AbortSignal.timeout(3000),
            })
              .then(async (response) => (response.ok ? v.safeParse(GitHubProfile, await response.json()) : null))
              .catch(() => null)
            const createdAt = profile?.success ? profile.output.created_at : undefined
            const githubCreatedAt = createdAt ? Date.parse(createdAt) : NaN
            if (Number.isFinite(githubCreatedAt))
              await db.update(users).set({ githubCreatedAt }).where(eq(users.id, account.userId))
          },
        },
      },
      user: {
        // Nobody outside DROP_MEMBERS gets an account, so the Members page lists only the people it lets in.
        create: {
          before: async (user) =>
            isListedMember(user) ? { data: { ...user, role: roleOf(user, env.drop.admins.unseal()) } } : false,
        },
      },
      // A sign-in may verify the email (or DROP_ADMINS may have changed since the account was made).
      session: {
        create: {
          // Someone taken off DROP_MEMBERS since they joined can't sign in again.
          before: async (session) => {
            const [person] = await db
              .select({ email: users.email, emailVerified: users.emailVerified })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1)
            if (!person || !isListedMember(person)) return false
          },
          after: async (session) => {
            await syncRole(session.userId)
          },
        },
      },
    },
    plugins: [
      proxyAuth(),
      admin({ ac, roles, defaultRole: "member" }),
      jwt(),
      oauthProvider({
        loginPage: "/oauth",
        consentPage: "/oauth",
        // The browser approval can involve a GitHub sign-in and a separate executor redirect.
        // Keep the signed handoff alive long enough for that round trip to finish.
        codeExpiresIn: 30 * 60,
        scopes: ["openid", "profile", "email", "offline_access"],
        resources: [`${requestOrigin}/mcp`],
        enforcePerClientResources: false,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // MCP clients register loopback or private-use redirects without `application_type`; register them as native.
        clientRegistrationDefaultApplicationType: "infer",
      }),
    ],
  }
})
