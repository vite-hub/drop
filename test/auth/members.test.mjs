import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "vite-plus/test"
// test/stubs.ts stubs Server Env and ViteHub Auth's checkAuthMember(), so the checks read VITEHUB_MEMBERS from `state`.
// ViteHub Auth's own tests cover its rules: verified emails, domains, accounts, admins and GitHub organizations.
import { migrate, reset, sql, state } from "../cost/harness.mjs"
const { isMember, membersOnly } = await import("../../server/utils/members.ts")
const { isListed } = await import("../../shared/roles.ts")

migrate()
beforeEach(() => {
  reset()
  sql.exec(`INSERT INTO user (id, name, email, email_verified) VALUES
    ('fran', 'Fran', 'fran@example.com', 1),
    ('stranger', 'Stranger', 'stranger@example.com', 1)`)
})
afterEach(() => {
  state.members = ""
  delete state.memberCheckError
})

test("without VITEHUB_MEMBERS, anyone with an account gets in", async () => {
  assert.equal(membersOnly(), false)
  assert.equal(await isMember("stranger"), true)
})

test("VITEHUB_MEMBERS lets in only the people ViteHub Auth lists", async () => {
  state.members = "fran@example.com"
  assert.equal(membersOnly(), true)
  assert.equal(await isMember("fran"), true)
  assert.equal(await isMember("stranger"), false)
  assert.equal(await isMember("gone"), false)
})

test("taking someone off VITEHUB_MEMBERS locks them out", async () => {
  state.members = "fran@example.com"
  assert.equal(await isMember("fran"), true)
  state.members = "someone@example.com"
  assert.equal(await isMember("fran"), false)
})

test("a GitHub outage answers 503 instead of locking a member out", async () => {
  Object.assign(state, { members: "github-org:acme", memberCheckError: "AUTH_GITHUB_UNAVAILABLE" })
  await assert.rejects(isMember("fran"), (error) => error.status === 503)
})

test("isListed is the check DROP_ADMINS uses", () => {
  assert.equal(isListed({ email: "a@example.com", emailVerified: true }, "b@example.com, A@example.com"), true)
  assert.equal(isListed({ email: "a@example.com", emailVerified: false }, "a@example.com"), false)
  assert.equal(isListed({ email: "a@example.com", emailVerified: false }, "a@example.com", true), true)
})
