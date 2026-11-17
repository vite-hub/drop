import { stripe } from "@better-auth/stripe"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, organization as teamsPlugin } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import type { Stripe } from "stripe"
import { useRuntimeConfig } from "nitro/runtime-config"
import * as v from "valibot"
import { createDatabaseAuthEventStore, defineAuth } from "vite-hub/auth"
import { mcpOAuth } from "vite-hub/auth/mcp"
import { db, schema } from "vite-hub/database"
import { user as users } from "./databases/default/index"
import { ac, roles } from "./utils/access"
import { authAccessLines, countDropsByUser } from "./utils/auth-console"
import { authRequest, logAudit, requestLog } from "./utils/logs"
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
import { currentRoleAdapter } from "./utils/current-role-adapter"
import { lazyClient } from "./utils/lazy-client"
import { teamLimitAdapter } from "./utils/team-limit-adapter"
import { TIERS } from "#shared/quotas"

// The account's creation date, a review signal (shared/trust.ts).
const GitHubProfile = v.object({ created_at: v.optional(v.string()) })

interface BilledSubscription {
  id: string
  referenceId: string
  plan: string
  status?: string | null
  seats?: number | null
}

/** A Stripe webhook's outcome for a team's subscription, on the webhook request's wide event. */
const billed =
  (change: string) =>
  async ({ subscription }: { subscription: BilledSubscription }) => {
    const event = authRequest.getStore()
    const { id, referenceId: team, plan, status, seats } = subscription
    requestLog(event)?.set({ stripe: { subscription: { id, team, plan, status, seats, change } } })
    logAudit(event, "stripe", `billing.${change}`, { type: "team", id: team })
  }

/**
 * Who can sign in, and how.
 *
 * Drop signs in with GitHub. To use another provider, swap `socialProviders` (Google, GitLab, Discord…),
 * or add `emailAndPassword: { enabled: true }`, then set its secrets in nuxt.config.ts `vite.env.server.auth`.
 *
 * Anyone with a GitHub account can sign in and joins as a member. `VITEHUB_MEMBERS`, when set, lists the only people
 * who may: GitHub accounts, verified emails, email domains, or a GitHub organization (`github-org:acme`). ViteHub Auth
 * checks it at sign-up, at sign-in, and on running sessions, and adds `read:org` for an organization. Admins always
 * may. `DROP_ADMINS` lists the admins by email: whoever signs in with one, verified by the sign-in method, is an admin,
 * so swapping GitHub for another provider keeps the list. `roleOf` decides on every request; each new session writes
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
        // Stripe's SDK loads on the first billing call, so a Drop without billing never loads it.
        stripeClient: lazyClient<Stripe>(() =>
          import("stripe").then(
            ({ Stripe }) => new Stripe(billing.secretKey, { httpClient: Stripe.createFetchHttpClient() }),
          ),
        ),
        plans: teamPlans(billing),
      }
    : undefined
  const password = import.meta.dev === true || env.drop.testSignin
  const quotas = env.drop.quotas.enabled
  const { clientIpHeader } = useRuntimeConfig()
  return {
    appName: "Drop",
    baseURL: requestOrigin,
    database: currentRoleAdapter(teamLimitAdapter(drizzleAdapter(db, { provider: "sqlite", schema })), (person) =>
      roleOf(person, env.drop.admins.unseal()),
    ),
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
      // Only the platform/proxy's client address; never fall back to a caller's X-Forwarded-For. Without a header
      // (Cloudflare, Deno), ViteHub's default: the address the runtime reports.
      ...(clientIpHeader ? { ipAddress: { ipAddressHeaders: [clientIpHeader] } } : {}),
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
          github: { clientId: env.auth.github.clientId.unseal(), clientSecret: env.auth.github.clientSecret.unseal() },
        },
    emailAndPassword: { enabled: password },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
    // Free or Pro (shared/quotas.ts TIERS). The Console edits it through Better Auth's admin plugin.
    user: { additionalFields: { plan: { type: [...TIERS], required: false, input: false, returned: quotas } } },
    console: {
      fields: { plan: { label: "Plan", editable: quotas, reason: "Plans apply only when DROP_QUOTAS is on." } },
      columns: {
        drops: {
          label: "Drops",
          type: "number",
          read: (people) => countDropsByUser(people.map((person) => person.id)),
        },
      },
      // Labels and the Admins filter show the role DROP_ADMINS gives each account now, not the one stored at sign-in.
      roles: {
        editable: false,
        reason: "Admins come from DROP_ADMINS, set where Drop is deployed.",
        read: (people) => Object.fromEntries(people.map((person) => [person.id, roleOf(person)])),
      },
      actions: { impersonate: { editable: false, reason: "Drop does not allow signing in as another person." } },
      access: authAccessLines({ proxied, password }),
    },
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
              .catch((error: unknown) => {
                requestLog(authRequest.getStore())?.warn("GitHub profile lookup failed", {
                  github: { profile: error instanceof Error ? error.message : String(error) },
                })
                return null
              })
            const createdAt = profile?.success ? profile.output.created_at : undefined
            const githubCreatedAt = createdAt ? Date.parse(createdAt) : NaN
            if (Number.isFinite(githubCreatedAt))
              await db.update(users).set({ githubCreatedAt }).where(eq(users.id, account.userId))
          },
        },
      },
      user: {
        create: { before: async (user) => ({ data: { ...user, role: roleOf(user, env.drop.admins.unseal()) } }) },
        // Their memberships go first, so the team's seats in Stripe drop and its ownership passes on.
        delete: {
          before: async (user, context) => {
            // An admin may delete someone else's account.
            const by = context?.context.session?.user.id ?? user.id
            logAudit(authRequest.getStore(), { userId: by, actorKind: "browser" }, "account.delete", {
              type: "user",
              id: user.id,
            })
            await leaveTeams(user, context, teamBilling)
          },
        },
      },
      // A sign-in may verify the email (or DROP_ADMINS may have changed since the account was made).
      session: {
        create: {
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
              onEvent: async (event) => {
                requestLog(authRequest.getStore())?.set({ stripe: { event: { type: event.type, id: event.id } } })
              },
              subscription: {
                enabled: true,
                plans: teamBilling.plans,
                // Only a team's owner and admins pay for it, see its billing, or cancel.
                authorizeReference: authorizeBilling,
                getCheckoutSessionParams: () => checkoutParams(billing.managedPayments),
                onSubscriptionCreated: billed("created"),
                onSubscriptionComplete: billed("completed"),
                onSubscriptionUpdate: billed("updated"),
                onSubscriptionCancel: billed("canceling"),
                onSubscriptionDeleted: billed("deleted"),
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
