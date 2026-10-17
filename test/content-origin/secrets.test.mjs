import assert from "node:assert/strict"
import { test } from "node:test"
const { authSecret, deriveSecret } = await import("../../server/utils/secrets.ts")

const env = (root, auth = "") => ({ secret: { unseal: () => root }, auth: { secret: { unseal: () => auth } } })

test("every key derives from VITEHUB_SECRET, one per purpose", () => {
  const a = deriveSecret(env("root-a"), "content-origin")
  assert.equal(deriveSecret(env("root-a"), "content-origin"), a)
  assert.notEqual(deriveSecret(env("root-a"), "auth"), a)
  assert.notEqual(deriveSecret(env("root-b"), "content-origin"), a)
  assert.doesNotMatch(a, /root-a/)
  assert.equal(authSecret(env("root-a")), deriveSecret(env("root-a"), "auth"))
})

test("BETTER_AUTH_SECRET keeps existing sessions, and stands in as the root when VITEHUB_SECRET is unset", () => {
  assert.equal(authSecret(env("root", "legacy")), "legacy")
  assert.equal(deriveSecret(env("", "legacy"), "content-origin"), deriveSecret(env("legacy"), "content-origin"))
  assert.throws(() => deriveSecret(env(""), "auth"), /Set VITEHUB_SECRET/)
})
