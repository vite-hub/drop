import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { authAccessLines } = await import("../../server/utils/auth-console.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { H3Event } = await import("h3")

migrate()
beforeEach(() => {
  reset()
  Object.assign(state, { members: "", githubOrg: "", contentOrigin: "" })
})

test("content-origin hosts never reach the Console endpoint", async () => {
  state.contentOrigin = "https://*-drop.vitehub.dev"
  for (const hostname of [`${"a".repeat(26)}-drop.vitehub.dev`, "stray-drop.vitehub.dev"])
    for (const method of ["GET", "POST"]) {
      const request = new Request(`https://${hostname}/_vitehub/rpc`, { method })
      assert.equal((await contentMiddleware(new H3Event(request))).status, 404)
    }
})

test("access notes describe the configured allowlist, organization and sign-in methods", () => {
  const open = authAccessLines({ members: false, organization: "", proxied: false, password: false })
  assert.ok(open.includes("DROP_MEMBERS is off: there is no email allowlist."))
  assert.ok(open.includes("Sign-in uses GitHub."))
  const restricted = authAccessLines({ members: true, organization: "vite-hub", proxied: true, password: true }).join(
    "\n",
  )
  assert.match(restricted, /DROP_MEMBERS is on/)
  assert.match(restricted, /GitHub organization vite-hub/)
  assert.match(restricted, /oauth2-proxy/)
  assert.match(restricted, /Email and password/)
})
