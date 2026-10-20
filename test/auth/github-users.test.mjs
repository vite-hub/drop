import assert from "node:assert/strict"
import { afterEach, test } from "vite-plus/test"
// test/stubs.ts stubs Server Env, so the gate reads DROP_GITHUB_USERS and DROP_GITHUB_ORG from `state`.
import { state } from "../cost/harness.mjs"
const { isGitHubMember, membersOnly } = await import("../../server/utils/github-membership.ts")

const realFetch = globalThis.fetch
const calls = []
// GitHub answers as the token's account: `login-<name>` is that login, and `org-<name>` is an active org member.
function github() {
  globalThis.fetch = async (url, init) => {
    const token = init.headers.Authorization.replace("Bearer ", "")
    calls.push(new URL(url).pathname)
    if (new URL(url).pathname === "/user")
      return Response.json({ login: token.startsWith("login-") ? token.slice(6) : "someone-else" })
    return token.startsWith("org-") ? Response.json({ state: "active" }) : new Response("", { status: 404 })
  }
}

afterEach(() => {
  globalThis.fetch = realFetch
  calls.length = 0
  Object.assign(state, { githubUsers: "", githubOrg: "" })
})

test("without DROP_GITHUB_USERS or DROP_GITHUB_ORG, anyone with GitHub gets in", async () => {
  assert.equal(membersOnly(), false)
  assert.equal(await isGitHubMember(null), true)
})

test("DROP_GITHUB_USERS lets in only the logins it lists, in any case", async () => {
  github()
  Object.assign(state, { githubUsers: " Octocat, hubot " })
  assert.equal(membersOnly(), true)
  assert.equal(await isGitHubMember("login-octocat"), true)
  assert.equal(await isGitHubMember("login-HUBOT"), true)
  assert.equal(await isGitHubMember("login-stranger"), false)
  assert.equal(await isGitHubMember(null), false)
  // Without DROP_GITHUB_ORG, nothing asks GitHub about organizations.
  assert.ok(calls.every((path) => path === "/user"))
})

test("with both settings, the people listed and the organization's members get in", async () => {
  github()
  Object.assign(state, { githubUsers: "outside-friend", githubOrg: "acme" })
  assert.equal(await isGitHubMember("login-outside-friend"), true)
  assert.equal(await isGitHubMember("org-member"), true)
  assert.equal(await isGitHubMember("nobody"), false)
})

test("a GitHub failure keeps people out", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline")
  }
  Object.assign(state, { githubUsers: "octocat" })
  // A token the earlier tests never checked, so no cached success answers for it.
  assert.equal(await isGitHubMember("login-octocat-offline"), false)
})
