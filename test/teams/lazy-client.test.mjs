import assert from "node:assert/strict"
import { Stripe } from "stripe"
import { test } from "vite-plus/test"

const { lazyClient } = await import("../../server/utils/lazy-client.ts")

// Stripe's list(): a promise of the first page that also iterates every item.
const listOf = (items) =>
  Object.assign(Promise.resolve({ data: items.slice(0, 1) }), {
    async *[Symbol.asyncIterator]() {
      yield* items
    },
  })

test("the client loads on its first call, once, and calls each method on its own resource", async () => {
  let loads = 0
  const client = lazyClient(async () => {
    loads++
    return {
      customers: {
        prefix: "cus_",
        async create(params) {
          return { id: `${this.prefix}1`, ...params }
        },
        list: () => listOf([{ id: "cus_1" }, { id: "cus_2" }]),
      },
    }
  })
  // What Better Auth's Stripe plugin does before any call.
  assert.equal(typeof client.webhooks.constructEventAsync, "function")
  assert.equal(client.then, undefined, "the client isn't a promise, so awaiting it keeps it")
  assert.equal(loads, 0)

  assert.deepEqual(await client.customers.create({ name: "Acme" }), { id: "cus_1", name: "Acme" })
  assert.deepEqual(await client.customers.list(), { data: [{ id: "cus_1" }] })
  const all = []
  for await (const customer of client.customers.list()) all.push(customer.id)
  assert.deepEqual(all, ["cus_1", "cus_2"])
  assert.equal(loads, 1)

  await assert.rejects(client.customers.prefix(), TypeError, "a path that names no method")
})

test("a lazy Stripe client verifies a webhook as the SDK does", async () => {
  const stripe = new Stripe("sk_test_x", { httpClient: Stripe.createFetchHttpClient() })
  const client = lazyClient(async () => stripe)
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.created" })
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_test" })
  const event = await client.webhooks.constructEventAsync(payload, header, "whsec_test")
  assert.equal(event.id, "evt_1")
  await assert.rejects(client.webhooks.constructEventAsync(payload, header, "whsec_other"), /signature/i)
})
