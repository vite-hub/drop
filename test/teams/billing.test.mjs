import assert from "node:assert/strict"
import { stripe } from "@better-auth/stripe"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/config.ts")
const { authorizeBilling, checkoutParams, teamPlans } = await import("../../server/utils/teams.ts")

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

async function checkout(annual, managedPayments = false, { status } = {}) {
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
          authorizeReference: authorizeBilling,
          getCheckoutSessionParams: () => checkoutParams(managedPayments),
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
  if (status)
    sql
      .prepare("INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'team', ?, ?)")
      .run(team.id, status)
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
  return sessions[0]
}

test("a team billed monthly pays the monthly price per member", async () => {
  assert.deepEqual((await checkout(false)).line_items, [{ price: "price_month", quantity: 1 }])
})

test("a team billed yearly pays the yearly price per member", async () => {
  assert.deepEqual((await checkout(true)).line_items, [{ price: "price_year", quantity: 1 }])
})

test("with Managed Payments, Checkout leaves the customer's name and address to Stripe", async () => {
  const session = await checkout(false, true)
  assert.deepEqual(session.managed_payments, { enabled: true })
  // Stripe rejects customer_update[name] and customer_update[address] with Managed Payments; an empty one isn't sent.
  assert.deepEqual(session.customer_update, {})
})

test("without Managed Payments, Checkout saves the address it collects on the team's customer", async () => {
  const session = await checkout(false)
  assert.equal(session.managed_payments, undefined)
  assert.deepEqual(session.customer_update, { address: "auto" })
})

for (const status of ["past_due", "unpaid"])
  test(`a team whose payment is ${status} updates its card instead of starting a second subscription`, async () => {
    await assert.rejects(checkout(false, false, { status }), /payment failed/i)
  })

test("a team whose subscription ended starts a new one", async () => {
  assert.ok(await checkout(false, false, { status: "canceled" }))
})
