import { stripe } from "@better-auth/stripe"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { github } from "better-auth/social-providers"
import { admin, organization as teamsPlugin } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import { Stripe } from "stripe"
import { useRuntimeConfig } from "nitro/runtime-config"
import * as v from "valibot"
import { createDatabaseAuthEventStore, defineAuth } from "vite-hub/auth"
import { mcpOAuth } from "vite-hub/auth/mcp"
import { db, schema } from "vite-hub/database"
import { profile, user as users } from "./databases/default/index"
import { ac, roles } from "./utils/access"
import { authAccessLines, countDropsByUser, readPlans } from "./utils/auth-console"
import { isGitHubMember } from "./utils/github-membership"
import { isListedMember } from "./utils/members"
import { roleOf, syncRole } from "./utils/identity"
import { authProxy, proxyAuth } from "./utils/proxy-auth"
import {
  authorizeBilling,
  billingConfig,
  checkoutParams,
  leaveTeams,
  teamOptions,
  teamPlans,
  teamsEnabled,
} from "./utils/teams"
import { teamLimitAdapter } from "./utils/team-limit-adapter"

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
 * Teams (`DROP_TEAMS`, ./utils/teams.ts) are Better Auth organizations; Drop sends no invitation emails, so whoever
 * invites copies the link. With Stripe set up (`STRIPE_*`), a team past its free members needs a subscription, one seat
 * per member, which Stripe's plugin keeps in step as people join and leave.
 */
export default defineAuth(({ env, requestOrigin }) => {
  const proxied = authProxy().enabled
  const teams = teamsEnabled()
  const billing = billingConfig()
  const teamBilling = billing.enabled
    ? {
        stripeClient: new Stripe(billing.secretKey, { httpClient: Stripe.createFetchHttpClient() }),
        plans: teamPlans(billing),
      }
    : undefined
  const organization = env.drop.githubOrg.trim()
  const password = import.meta.dev === true || env.drop.testSignin
  const quotas = env.drop.quotas.enabled
  const { clientIpHeader } = useRuntimeConfig()
  const githubOptions = {
    clientId: proxied ? "" : env.auth.github.clientId.unseal(),
    clientSecret: proxied ? "" : env.auth.github.clientSecret.unseal(),
    scope: organization ? ["read:org"] : undefined,
  }
  return {
    appName: "Drop",
    baseURL: requestOrigin,
    database: teamLimitAdapter(drizzleAdapter(db, { provider: "sqlite", schema })),
    // Default retention: 90 days / 100,000 events. ViteHub strips IPs and secrets and isolates write failures.
    events: { store: createDatabaseAuthEventStore({ db }) },
    secret: env.auth.secret.unseal(),
    // Better Auth's limits: 5 client registrations a minute per IP, 3 sign-in attempts in 10 seconds, and more. It turns
    // them on only when NODE_ENV is production, which a Worker doesn't set, so they're on here outside `nuxt dev`. Each
    // request builds its own Auth (`requestOrigin`), so the default memory store would start every counter at zero:
    // they count in the database (rate_limit).
    rateLimit: { enabled: import.meta.dev !== true, storage: "database" },
    route: false,
    advanced: {
      // Only the platform/proxy's client address; never fall back to a caller's X-Forwarded-For.
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
      // `__Host-` cookies can't be set or replaced from another subdomain, such as the content origin where drops run
      // their own scripts. Better Auth would prefix `__Secure-`, which a subdomain can still overwrite.
      ...(requestOrigin.startsWith("https://")
        ? { useSecureCookies: false, cookiePrefix: "__Host-drop", defaultCookieAttributes: { secure: true } }
        : {}),
    },
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
    emailAndPassword: { enabled: password },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
    console: {
      columns: {
        drops: {
          label: "Drops",
          type: "number",
          read: (people) => countDropsByUser(people.map((person) => person.id)),
        },
        // Free or Pro (shared/quotas.ts TIERS), kept in Drop's profile table, so the Console shows it but can't change it.
        ...(quotas
          ? { plan: { label: "Plan", type: "string", read: (people) => readPlans(people.map((person) => person.id)) } }
          : {}),
      },
      // Labels and the Admins filter show the role DROP_ADMINS gives each account now, not the one stored at sign-in.
      roles: {
        editable: false,
        reason: "Admins come from DROP_ADMINS, set where Drop is deployed.",
        read: (people) => Object.fromEntries(people.map((person) => [person.id, roleOf(person)])),
      },
      actions: { impersonate: { editable: false, reason: "Drop does not allow signing in as another person." } },
      access: authAccessLines({ members: Boolean(env.drop.members.unseal().trim()), organization, proxied, password }),
    },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            if (account.providerId !== "github") return
            // Public GitHub metadata is a review signal; a lookup failure never blocks private use.
            const details = await fetch(`https://api.github.com/user/${encodeURIComponent(account.accountId)}`, {
              headers: { "User-Agent": "Drop", Accept: "application/vnd.github+json" },
              signal: AbortSignal.timeout(3000),
            })
              .then(async (response) => (response.ok ? v.safeParse(GitHubProfile, await response.json()) : null))
              .catch(() => null)
            const createdAt = details?.success ? details.output.created_at : undefined
            const githubCreatedAt = createdAt ? Date.parse(createdAt) : NaN
            if (Number.isFinite(githubCreatedAt))
              await db
                .insert(profile)
                .values({ userId: account.userId, githubCreatedAt })
                .onConflictDoUpdate({ target: profile.userId, set: { githubCreatedAt } })
          },
        },
      },
      user: {
        // Nobody outside DROP_MEMBERS gets an account.
        create: {
          before: async (user) =>
            isListedMember(user) ? { data: { ...user, role: roleOf(user, env.drop.admins.unseal()) } } : false,
          // What Drop keeps about the account (databases/default/profile.ts) starts empty: the default plan.
          after: async (user) => {
            await db.insert(profile).values({ userId: user.id }).onConflictDoNothing()
          },
        },
        // Their memberships go first, so the team's seats in Stripe drop and its ownership passes on.
        delete: { before: (user, context) => leaveTeams(user, context, teamBilling) },
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
      ...(teams ? [teamsPlugin(teamOptions)] : []),
      ...(teamBilling
        ? [
            stripe({
              stripeClient: teamBilling.stripeClient,
              stripeWebhookSecret: billing.webhookSecret,
              organization: { enabled: true },
              subscription: {
                enabled: true,
                plans: teamBilling.plans,
                // Only a team's owner and admins pay for it, see its billing, or cancel.
                authorizeReference: authorizeBilling,
                getCheckoutSessionParams: () => checkoutParams(billing.managedPayments),
              },
            }),
          ]
        : []),
      ...mcpOAuth({
        resource: `${requestOrigin}/mcp`,
        loginPage: "/oauth",
        provider: {
          // The browser approval can involve a GitHub sign-in and a separate executor redirect.
          // Keep the signed handoff alive long enough for that round trip to finish.
          codeExpiresIn: 30 * 60,
          enforcePerClientResources: false,
        },
      }),
    ],
  }
})
