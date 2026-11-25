import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { H3Event, HTTPError } from "h3"
// test/stubs.ts stubs Server Env, so the error page reads the proxy setting the way it does under Nitro.
import { state } from "../cost/harness.mjs"
const { default: contentError } = await import("../../server/handlers/content-error.ts")
const { background } = await import("../../server/utils/logs.ts")

const path = "/d/11111111-1111-4111-8111-111111111111"
async function render(status, identity = null, data, cookie) {
  const event = new H3Event(new Request(`https://drop.example${path}`, { headers: cookie ? { cookie } : {} }))
  event.context.dropIdentity = Promise.resolve(identity)
  return contentError(new HTTPError({ status, statusText: "Internal details must not appear", data }), event)
}

test("signed-out content errors lead with sign-in, which comes back to the original link", async () => {
  const response = await render(404)
  const html = await response.text()
  assert.equal(response.status, 404)
  assert.match(html, /<h1[^>]*>Sign in to open this drop<\/h1>/)
  // Signed out, nothing yet says private or deleted: that's for the card an account that can't open it sees.
  assert.match(html, /Drops shared with you or your team open right after you sign in\./)
  assert.doesNotMatch(html, /private|deleted/)
  assert.match(html, /Sign in with GitHub/)
  // Pressing it lets GitHub offer every account (`choose`).
  assert.ok(html.includes(`href="/signin/start?redirect=${encodeURIComponent(path)}&amp;choose=1&amp;via=card"`))
  assert.doesNotMatch(html, /Internal details must not appear/)
  // A pasted link unfurls as Drop's card, not as the error.
  assert.match(html, /<meta property="og:image" content="https:\/\/drop\.example\/og\.png">/)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  // The tab keeps Drop's icon, and the policy lets the browser fetch it.
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/)
  assert.match(response.headers.get("content-security-policy"), /img-src 'self'/)
})

test("signed-in content errors show only the current account and offer account switching", async () => {
  const response = await render(
    404,
    { email: "viewer+<test>@example.test" },
    { ownerEmail: "hidden-owner@example.test", title: "Secret title" },
  )
  const html = await response.text()
  assert.match(html, /viewer\+&lt;test&gt;@example.test/)
  assert.match(html, /You can&apos;t open this drop/)
  assert.match(html, /shared with this account, or it was deleted/)
  assert.match(html, /Use another account/)
  assert.doesNotMatch(html, /hidden-owner|Secret title|reconnect/i)
  assert.equal(response.status, 404)
})

test("only an explicit pending review error is described as waiting for review", async () => {
  assert.match(await (await render(403, null, { shareReview: "pending" })).text(), /Waiting for review/)
  assert.doesNotMatch(await (await render(403)).text(), /Waiting for review/)
})

test("service failures offer a retry without blaming account permissions", async () => {
  const response = await render(503)
  const html = await response.text()
  assert.equal(response.status, 503)
  assert.match(html, /Try again/)
  assert.doesNotMatch(html, /Sign in with GitHub|deleted|Internal details must not appear/)
})

test("behind the auth proxy, signed-in content errors don't send people back through sign-in", async () => {
  Object.assign(state, { authProxy: true, members: "github-org:acme" })
  try {
    const html = await (await render(404, { email: "member@example.test" })).text()
    assert.doesNotMatch(html, /Use another account|\/signin/)
    assert.equal(html.match(/href="\/drops"/g)?.length, 1)
    // Signed out, a fresh proxy login, whose token may have been revoked, then the guarded hop that makes Drop's session.
    const start = (via) =>
      `/oauth2/start?rd=${encodeURIComponent(`/signin/start?redirect=${encodeURIComponent(path)}&via=${via}`)}`
    const signedOut = await (await render(404)).text()
    assert.match(signedOut, /Sign in with GitHub/)
    assert.ok(signedOut.includes(`href="${start("card")}"`))
    assert.equal((await render(404, null, undefined, "drop-returning=1")).headers.get("location"), start("auto"))
  } finally {
    Object.assign(state, { authProxy: false, members: "" })
  }
})

test("a browser signed in before goes straight back through sign-in, once a minute", async () => {
  const back = await render(404, null, undefined, "drop-returning=1")
  assert.equal(back.status, 302)
  assert.equal(back.headers.get("location"), `/signin/start?redirect=${encodeURIComponent(path)}&via=auto`)
  assert.match(back.headers.get("set-cookie"), /^drop-signin-tried=1; Path=\/; Max-Age=60; SameSite=Lax; Secure$/)
  assert.equal(back.headers.get("cache-control"), "private, no-store")
  // Tried a minute ago: the sign-in didn't open it, so the page says why.
  assert.equal((await render(404, null, undefined, "drop-returning=1; drop-signin-tried=1")).status, 404)
  // Signed in, a new browser, or anything but the 404 a private, team or deleted drop gives: the page.
  assert.equal((await render(404, { email: "member@example.test" }, undefined, "drop-returning=1")).status, 404)
  assert.equal((await render(404)).status, 404)
  assert.equal((await render(410, null, undefined, "drop-returning=1")).status, 410)
  assert.equal((await render(403, null, { shareReview: "pending" }, "drop-returning=1")).status, 403)
  assert.equal((await render(503, null, undefined, "drop-returning=1")).status, 503)
})

test("the card logs card.shown with its reason, and the redirect logs signin.redirected", async () => {
  const info = vi.spyOn(background, "info").mockImplementation(() => {})
  const logged = () => info.mock.calls.map(([fields]) => fields)
  await render(404)
  await render(404, { email: "viewer@example.test" })
  await render(410)
  await render(503)
  assert.deepEqual(
    logged().map(({ action, client, path: at, status }) => ({ action, client, path: at, status })),
    [
      { action: "client-event", client: { event: "card.shown", reason: "signed-out" }, path, status: 404 },
      { action: "client-event", client: { event: "card.shown", reason: "no-access" }, path, status: 404 },
      { action: "client-event", client: { event: "card.shown", reason: "expired" }, path, status: 410 },
      { action: "client-event", client: { event: "card.shown", reason: "unavailable" }, path, status: 503 },
    ],
  )
  info.mockClear()
  assert.equal((await render(404, null, undefined, "drop-returning=1")).status, 302)
  assert.deepEqual(
    logged().map(({ client, status }) => ({ client, status })),
    [{ client: { event: "signin.redirected", mode: "github" }, status: 404 }],
  )
})

test("sign-in comes back only to a path on this Drop", async () => {
  const { nextPath } = await import("../../shared/sign-in.ts")
  const origin = "https://drop.example"
  assert.equal(nextPath(`${path}?v=2#c-1`, origin), `${path}?v=2#c-1`)
  for (const away of [
    null,
    "",
    "https://elsewhere.example/",
    "//elsewhere.example/",
    "/\\elsewhere.example",
    "d/x",
    // Same origin as a URL, but its path starts `//` once `..` resolves.
    "/a/..//elsewhere.example/",
  ])
    assert.equal(nextPath(away, origin), "/drops")
})
