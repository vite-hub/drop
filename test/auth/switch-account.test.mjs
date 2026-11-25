import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { createClientErrorReporter } from "../../app/utils/client-errors.ts"
import { switchProxyAccount, SwitchSignOutError } from "../../app/utils/switch-account.ts"

const start = "/oauth2/start?rd=%2Fsignin%2Fstart%3Fredirect%3D%252Fdrops"
const signedOut = `/oauth2/sign_out?rd=${encodeURIComponent(start)}`

test("using another account in proxy mode ends the Drop session before leaving for the proxy's sign-out", async () => {
  const steps = []
  let finish
  const signOut = (options) =>
    new Promise((resolve) => {
      assert.equal(options.fetchOptions.headers["x-drop-proxy-sign-out-handoff"], "1")
      steps.push("sign-out started")
      finish = () => {
        steps.push("sign-out finished")
        resolve({ error: null })
      }
    })
  const switching = switchProxyAccount(start, {
    signOut,
    navigate: (url) => steps.push(`navigate ${url}`),
  })
  await Promise.resolve()
  assert.deepEqual(steps, ["sign-out started"], "Navigation waits for the sign-out")
  finish()
  await switching
  assert.deepEqual(steps, ["sign-out started", "sign-out finished", `navigate ${signedOut}`])
})

test("unconfirmed sign-outs block navigation but report distinct failures on retry", async () => {
  const visited = []
  const sent = []
  const report = createClientErrorReporter((error, { fields }) =>
    sent.push({ message: error.message ?? error, ...fields }),
  )
  const network = new TypeError("fetch failed")
  const gateway = { message: "Bad Gateway", status: 502, code: "BAD_GATEWAY" }
  for (const failure of [network, gateway]) {
    const signOut = async () => {
      if (failure === network) throw failure
      return { error: failure }
    }
    await assert.rejects(switchProxyAccount(start, { signOut, navigate: (url) => visited.push(url) }), (error) => {
      assert.ok(error instanceof SwitchSignOutError)
      assert.equal(error.message, "Couldn't confirm sign-out. Try again.")
      assert.equal(error.cause, failure)
      report("signin-switch", error.cause, {}, { online: true, leaving: false })
      return true
    })
  }
  assert.deepEqual(visited, [])
  assert.deepEqual(
    sent.map(({ message, status, code }) => [message, status, code]),
    [
      ["fetch failed", undefined, undefined],
      ["[HTTP 502, code BAD_GATEWAY] Bad Gateway", 502, "BAD_GATEWAY"],
    ],
  )
})
