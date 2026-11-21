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
  logSubscription,
  teamOptions,
  teamPlans,
  teamsEnabled,
} from "./utils/teams"
import { currentRoleAdapter } from "./utils/current-role-adapter"
import { lazyClient } from "./utils/lazy-client"
import { teamLimitAdapter } from "./utils/team-limit-adapter"
import { TIERS } from "#shared/quotas"

const GitHubProfile = v.object({ created_at: v.optional(v.string()) })

function auditDeletion(
  user: { id: string },
  context: { context: { session?: { user: { id: string } } | null } } | null,
  outcome: "success" | "failure",
) {
  const by = context?.context.session?.user.id ?? user.id
  logAudit(
    authRequest.getStore(),
    { userId: by, actorKind: "browser" },
    "account.delete",
    { type: "user", id: user.id },
    outcome,
  )
}

export default defineAuth(({ env, requestOrigin }) => {
  const proxied = authProxy().enabled
  const teams = teamsEnabled()
  const billing = billingConfig()
  const teamBilling = billing.enabled
    ? {
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
    events: { store: createDatabaseAuthEventStore({ db }) },
    secret: env.auth.secret.unseal(),
    rateLimit: { enabled: import.meta.dev !== true, storage: "database" },
    route: false,
    advanced: {
      ...(clientIpHeader ? { ipAddress: { ipAddressHeaders: [clientIpHeader] } } : {}),
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
    access: { signIn: { errorCallbackURL: "/?auth_error=1", provider: "github" }, afterSignIn: "/drops" },
    socialProviders: proxied
      ? {}
      : {
          github: {
            clientId: env.auth.github.clientId?.unseal() ?? "",
            clientSecret: env.auth.github.clientSecret?.unseal() ?? "",
          },
        },
    emailAndPassword: { enabled: password },
    account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
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
        delete: {
          before: async (user, context) => {
            try {
              await leaveTeams(user, context, teamBilling)
            } catch (error) {
              auditDeletion(user, context, "failure")
              throw error
            }
          },
          after: async (user, context) => auditDeletion(user, context, "success"),
        },
      },
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
                authorizeReference: authorizeBilling,
                getCheckoutSessionParams: () => checkoutParams(billing.managedPayments),
                onSubscriptionCreated: logSubscription("created"),
                onSubscriptionComplete: logSubscription("completed"),
                onSubscriptionUpdate: logSubscription("updated"),
                onSubscriptionCancel: logSubscription("canceling"),
                onSubscriptionDeleted: logSubscription("deleted"),
              },
            }),
          ]
        : []),
      ...mcpOAuth({
        resource: `${requestOrigin}/mcp`,
        loginPage: "/oauth",
        provider: {
          codeExpiresIn: 30 * 60,
          enforcePerClientResources: false,
        },
      }),
    ],
  }
})
