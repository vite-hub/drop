import assert from "node:assert/strict"
import { test } from "node:test"
import { H3Event, HTTPError } from "h3"
import contentError from "../../server/handlers/content-error.ts"

const path = "/d/11111111-1111-4111-8111-111111111111"
async function render(status, identity = null, data) {
  const event = new H3Event(new Request(`https://drop.example${path}`))
  event.context.dropIdentity = Promise.resolve(identity)
  return contentError(new HTTPError({ status, statusText: "Internal details must not appear", data }), event)
}

test("signed-out content errors offer sign-in and preserve the original link", async () => {
  const response = await render(404)
  const html = await response.text()
  assert.equal(response.status, 404)
  assert.match(html, /Sign in with GitHub/)
  assert.ok(html.includes(`/signin?redirect=${encodeURIComponent(path)}`))
  assert.doesNotMatch(html, /Internal details must not appear/)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
})

test("signed-in content errors show only the current account and offer account switching", async () => {
  const response = await render(404, { email: 'viewer+<test>@example.test' }, { ownerEmail: "hidden-owner@example.test", title: "Secret title" })
  const html = await response.text()
  assert.match(html, /viewer\+&lt;test&gt;@example.test/)
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
