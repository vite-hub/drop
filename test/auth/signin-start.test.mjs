import assert from "node:assert/strict"
import { H3Event } from "h3"
import { test } from "vite-plus/test"
import { state } from "../cost/harness.mjs"

const { default: start } = await import("../../server/routes/signin/start.get.ts")

test("sign-in limits trusted IPv6 addresses by /64, not by the individual address", async () => {
  state.who = null
  state.bursts.length = 0
  state.auth = { api: { signInSocial: async () => Response.json({ url: "https://github.com/login" }) } }

  for (const address of [
    "2001:db8:1:2::1",
    "192.0.2.8, 2001:0DB8:0001:0002:3333:4444:5555:6666",
    "2001:db8:1:3::1",
    "198.51.100.7",
    "198.51.100.8",
  ]) {
    const event = new H3Event(
      new Request("https://drop.example/signin/start", { headers: { "x-forwarded-for": address } }),
    )
    await start(event)
  }

  const [first, sameSubnet, otherSubnet, ipv4, otherIpv4] = state.bursts
  assert.deepEqual(first, { bucket: "sign-in-start", key: sameSubnet.key, limit: 10, window: "1m" })
  assert.ok(first.key)
  assert.notEqual(first.key, otherSubnet.key)
  assert.equal(ipv4.key, "198.51.100.7")
  assert.equal(otherIpv4.key, "198.51.100.8")
})
