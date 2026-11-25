import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { switchProxyAccount } from "../../app/utils/switch-account.ts"

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

for (const [label, signOut] of [
  ["answers with an error", async () => ({ error: { message: "Bad Gateway", status: 502 } })],
  [
    "throws",
    async () => {
      throw new TypeError("fetch failed")
    },
  ],
]) {
  test(`using another account stays on the page when the Drop sign-out ${label}`, async () => {
    const visited = []
    await assert.rejects(
      () => switchProxyAccount(start, { signOut, navigate: (url) => visited.push(url) }),
      label === "throws" ? /fetch failed/ : { message: "Bad Gateway", status: 502 },
    )
    assert.deepEqual(visited, [])
  })
}
