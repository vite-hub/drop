import assert from "node:assert/strict"
import { stripe } from "@better-auth/stripe"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/config.ts")
const { teamPlans } = await import("../../server/utils/teams.ts")

// The Team plan through Stripe's plugin, with a Stripe client that keeps what Checkout was asked to bill.
migrate()
beforeEach(() => reset())

function stripeClient(sessions) {
  const none = async () => ({ data: [] })
  return {
    customers: { search: none, list: none, create: async (params) => ({ id: "cus_team", ...params }) },
    subscriptions: { list: none },
    prices: { list: none, retrieve: async (id) => ({ id, recurring: { usage_type: "licensed" } }) },
    checkout: {
      sessions: {
        create: async (params) => {
          sessions.push(params)
          return { id: "cs_test", url: "https://checkout.stripe.example/cs_test" }
        },
      },
    },
  }
}

async function checkout(annual) {
  const sessions = []
  const auth = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({ creatorRole: "owner" }),
      stripe({
        stripeClient: stripeClient(sessions),
        stripeWebhookSecret: "whsec_test",
        organization: { enabled: true },
        subscription: {
          enabled: true,
          plans: teamPlans({ priceId: "price_month", annualPriceId: "price_year" }),
          authorizeReference: async () => true,
        },
      }),
    ],
  })
  const signedUp = await auth.api.signUpEmail({
    body: { email: "payer@example.com", password: "a-long-password", name: "Payer" },
    returnHeaders: true,
  })
  const headers = new Headers({ cookie: signedUp.headers.get("set-cookie").split(";")[0] })
  const team = await auth.api.createOrganization({ headers, body: { name: "Acme", slug: "acme" } })
  await auth.api.upgradeSubscription({
    headers,
    body: {
      // What app/composables/useTeams.ts asks for.
      plan: annual ? "team-annual" : "team",
      referenceId: team.id,
      customerType: "organization",
      successUrl: "/teams",
      cancelUrl: "/teams",
      disableRedirect: true,
    },
  })
  return sessions[0].line_items
}

test("a team billed monthly pays the monthly price per member", async () => {
  assert.deepEqual(await checkout(false), [{ price: "price_month", quantity: 1 }])
})

test("a team billed yearly pays the yearly price per member", async () => {
  assert.deepEqual(await checkout(true), [{ price: "price_year", quantity: 1 }])
})
