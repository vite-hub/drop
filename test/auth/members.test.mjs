import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "vite-plus/test"
// test/stubs.ts stubs Server Env, so the checks read DROP_MEMBERS, DROP_ADMINS and DROP_GITHUB_ORG from `state`.
import { migrate, reset, sql, state } from "../cost/harness.mjs"
const { isListedMember, isMember, membersOnly } = await import("../../server/utils/members.ts")
const { isListed } = await import("../../shared/roles.ts")

migrate()
beforeEach(() => {
  reset()
  sql.exec(`INSERT INTO user (id, name, email, email_verified) VALUES
    ('maxi', 'Maxi', 'maxi@example.com', 1),
    ('fran', 'Fran', 'Fran@Example.com', 1),
    ('typed', 'Typed', 'fran@example.com', 0),
    ('stranger', 'Stranger', 'stranger@example.com', 1)`)
})
afterEach(() => {
  state.members = ""
  state.githubOrg = ""
})

test("without DROP_MEMBERS or DROP_GITHUB_ORG, anyone with an account gets in", async () => {
  assert.equal(membersOnly(), false)
  assert.equal(await isMember("stranger"), true)
  assert.equal(isListedMember({ email: "anyone@example.com", emailVerified: false }), true)
})

test("DROP_MEMBERS lets in only the verified emails it lists, plus the admins", async () => {
  Object.assign(state, { members: " fran@example.com ", admins: "maxi@example.com" })
  assert.equal(membersOnly(), true)
  assert.equal(await isMember("fran"), true, "emails compare without case")
  assert.equal(await isMember("maxi"), true, "admins always get in")
  assert.equal(await isMember("stranger"), false)
  assert.equal(await isMember("typed"), false, "an unverified email proves nothing")
  assert.equal(await isMember("gone"), false)
})

test("taking someone off DROP_MEMBERS locks them out", async () => {
  state.members = "fran@example.com"
  assert.equal(await isMember("fran"), true)
  state.members = "someone@example.com"
  assert.equal(await isMember("fran"), false)
})

test("with DROP_GITHUB_ORG too, a listed person still needs the organization", async () => {
  Object.assign(state, { members: "fran@example.com", githubOrg: "acme" })
  // Fran has no GitHub account here, so GitHub can't vouch for an organization membership.
  assert.equal(await isMember("fran"), false)
})

test("isListed is the same check DROP_ADMINS uses", () => {
  assert.equal(isListed({ email: "a@example.com", emailVerified: true }, "b@example.com, A@example.com"), true)
  assert.equal(isListed({ email: "a@example.com", emailVerified: false }, "a@example.com"), false)
  assert.equal(isListed({ email: "a@example.com", emailVerified: false }, "a@example.com", true), true)
})
