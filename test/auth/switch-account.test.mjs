import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { switchProxyAccount } from "../../app/utils/switch-account.ts"

const start = "/oauth2/start?rd=%2Fsignin%2Fstart%3Fredirect%3D%252Fdrops"
const signedOut = `/oauth2/sign_out?rd=${encodeURIComponent(start)}`

test("using another account in proxy mode ends the Drop session before leaving for the proxy's sign-out", async () => {
  const steps = []
  let finish
  const signOut = () =>
    new Promise((resolve) => {
      steps.push("sign-out started")
      finish = () => {
        steps.push("sign-out finished")
        resolve({ error: null })
      }
    })
  const switching = switchProxyAccount(start, {
    signOut,
    navigate: (url) => steps.push(`navigate ${url}`),
    failed: (cause) => assert.fail(cause),
  })
  await Promise.resolve()
  assert.deepEqual(steps, ["sign-out started"], "Navigation waits for the sign-out")
  finish()
  await switching
  assert.deepEqual(steps, ["sign-out started", "sign-out finished", `navigate ${signedOut}`])
})

for (const [label, signOut] of [
  ["answers with an error", async () => ({ error: { message: "Server error", status: 500 } })],
  [
    "throws",
    async () => {
      throw new TypeError("fetch failed")
    },
  ],
]) {
  test(`using another account still reaches the proxy's sign-out when the Drop sign-out ${label}`, async () => {
    const visited = []
    const failures = []
    await switchProxyAccount(start, {
      signOut,
      navigate: (url) => visited.push(url),
      failed: (cause) => failures.push(cause),
    })
    assert.deepEqual(visited, [signedOut])
    assert.equal(failures.length, 1, "The failed sign-out is reported")
  })
}
