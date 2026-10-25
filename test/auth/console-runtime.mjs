// Run against an isolated local Worker with DROP_TEST_SIGNIN=true, DROP_QUOTAS=true,
// DROP_ADMINS=console-admin@example.com, and migrated local D1. Never point this at a deployment.
import assert from "node:assert/strict"
import { readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { get } from "node:http"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

const origin = process.env.DROP_CONSOLE_TEST_ORIGIN || "http://localhost:3417"
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
const directory = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
const file = readdirSync(directory).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
assert.ok(file, "Apply local D1 migrations first")
const db = new DatabaseSync(join(directory, file))
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000")
const fixture = []

async function request(path, { cookie = "", method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: "manual",
    headers: {
      cookie,
      origin,
      "x-vitehub-console": "1",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: response.status, headers: response.headers, data, text }
}

const manage = (cookie, body) => request("/_vitehub/auth/manage", { cookie, method: "POST", body })
const rpc = (cookie, method) =>
  request("/_vitehub/rpc/__call", { cookie, method: "POST", body: { method: `vitehub:console:${method}`, input: {} } })

async function signup(name, email) {
  const password = `Local-${crypto.randomUUID()}`
  const result = await request("/api/auth/sign-up/email", { method: "POST", body: { name, email, password } })
  assert.equal(result.status, 200, result.text)
  const person = {
    id: result.data.user.id,
    name,
    email,
    password,
    cookie: result.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  }
  fixture.push(person)
  db.prepare("UPDATE user SET email_verified=1, plan='free' WHERE id=?").run(person.id)
  return person
}

await test("Worker Console authorization, actions, section limits and removed Members routes", async () => {
  let succeeded = false
  const admin = await signup("Alex Morgan", "console-admin@example.com")
  const member = await signup("Sam Rivera", "console-member@example.com")
  const other = await signup("Jamie Lee", "console-other@example.com")
  try {
    for (const cookie of ["", member.cookie]) {
      const expected = cookie ? 403 : 401
      // ViteHub serves a static shell; every data request is guarded separately.
      const shell = await request("/_vitehub/auth", { cookie })
      assert.equal(shell.status, 200)
      assert.doesNotMatch(shell.text, /console-(?:admin|member|other)@example\.com/)
      assert.equal((await manage(cookie, { operation: "users" })).status, expected)
      assert.equal((await rpc(cookie, "sections")).status, expected)
      assert.equal((await rpc(cookie, "status")).status, expected)
      assert.equal((await request("/api/_vitehub/console/status", { cookie })).status, 404)
    }
    db.prepare("UPDATE user SET email_verified=0 WHERE id=?").run(admin.id)
    assert.equal((await manage(admin.cookie, { operation: "users" })).status, 403)
    db.prepare("UPDATE user SET email_verified=1, role='member' WHERE id=?").run(admin.id)
    const page = await request("/_vitehub/auth", { cookie: admin.cookie })
    assert.equal(page.status, 200, page.text)
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/)
    assert.doesNotMatch(page.headers.get("content-security-policy"), /strict-dynamic|nonce-/)
    const description = await manage(admin.cookie, { operation: "describe" })
    assert.equal(description.status, 200, description.text)
    assert.equal(db.prepare("SELECT role FROM user WHERE id=?").get(admin.id).role, "admin")
    assert.equal(description.data.fields.find((field) => field.key === "plan").edit.enabled, true)
    assert.equal(description.data.fields.find((field) => field.key === "drops").computed, true)
    assert.equal(description.data.actions.setRole.enabled, false)
    assert.equal(description.data.actions.setRole.reason, "Admins come from DROP_ADMINS, set where Drop is deployed.")
    assert.equal(description.data.actions.impersonate.enabled, false)
    assert.ok(description.data.access.some((line) => line.includes("DROP_MEMBERS is off")))
    assert.equal((await rpc(admin.cookie, "database")).status, 403)
    assert.equal((await rpc(admin.cookie, "env")).status, 403)
    const users = await manage(admin.cookie, { operation: "users" })
    assert.equal(users.status, 200, users.text)
    assert.ok(users.data.items.some((user) => user.id === member.id && user.fields.drops === 0))
    for (const action of ["setRole", "impersonate"])
      assert.equal((await manage(admin.cookie, { action, userId: member.id, role: "admin" })).status, 403)
    for (const action of ["ban", "remove"])
      assert.notEqual((await manage(admin.cookie, { action, userId: admin.id })).status, 200, "Self-action must fail")
    assert.equal(db.prepare("SELECT banned FROM user WHERE id=?").get(admin.id).banned, 0)
    assert.equal(
      (await manage(admin.cookie, { action: "editField", userId: member.id, field: "plan", value: "unlimited" }))
        .status,
      400,
    )
    // Repeat the stale-role case immediately before a mutation, without opening the Console first.
    db.prepare("UPDATE user SET role='member' WHERE id=?").run(admin.id)
    const plan = await manage(admin.cookie, { action: "editField", userId: member.id, field: "plan", value: "pro" })
    assert.equal(plan.status, 200, plan.text)
    assert.equal(db.prepare("SELECT plan FROM user WHERE id=?").get(member.id).plan, "pro")
    const sessions = await manage(admin.cookie, { operation: "sessions", query: { userId: other.id } })
    assert.equal(sessions.status, 200, sessions.text)
    assert.ok(sessions.data.items.length)
    const revoke = await manage(admin.cookie, { action: "revokeSession", id: sessions.data.items[0].id })
    assert.equal(revoke.status, 200, revoke.text)
    assert.equal(db.prepare("SELECT count(*) AS n FROM session WHERE user_id=?").get(other.id).n, 0)
    assert.ok((await request("/api/me", { cookie: other.cookie })).data == null)
    const ban = await manage(admin.cookie, { action: "ban", userId: member.id, reason: "Local verification" })
    assert.equal(ban.status, 200, ban.text)
    assert.equal(db.prepare("SELECT banned FROM user WHERE id=?").get(member.id).banned, 1)
    assert.equal((await manage(member.cookie, { operation: "users" })).status, 401)
    const unban = await manage(admin.cookie, { action: "unban", userId: member.id })
    assert.equal(unban.status, 200, unban.text)
    assert.equal(db.prepare("SELECT banned FROM user WHERE id=?").get(member.id).banned, 0)
    assert.equal((await request("/members", { cookie: admin.cookie })).status, 404)
    assert.equal((await request("/api/members", { cookie: admin.cookie })).status, 404)
    const people = await request("/api/people", { cookie: admin.cookie })
    assert.equal(people.status, 200, people.text)
    assert.deepEqual(Object.keys(people.data[0]).sort(), ["id", "image", "name"])
    assert.equal((await request("/api/people")).status, 401)
    assert.equal(
      (
        await request("/_vitehub/auth/manage", {
          cookie: admin.cookie,
          method: "POST",
          body: { operation: "users" },
          headers: { origin: "http://sibling.localhost:3417" },
        })
      ).status,
      403,
    )
    // node:http preserves Host; fetch replaces it with the connection's hostname.
    for (const host of [`${"a".repeat(26)}-drop.localhost:3417`, "stray-drop.localhost:3417"])
      for (const path of ["/_vitehub/auth", "/_vitehub/auth/manage", "/api/_vitehub/console/status"])
        await new Promise((resolve, reject) => {
          get(`${origin}${path}`, { headers: { host, cookie: admin.cookie } }, (response) => {
            response.resume()
            try {
              assert.equal(response.statusCode, 404, `${host}${path}`)
              resolve()
            } catch (error) {
              reject(error)
            }
          }).on("error", reject)
        })
    succeeded = true
    if (process.env.DROP_CONSOLE_KEEP_FIXTURE) {
      mkdirSync(".cache/console-evidence", { recursive: true })
      writeFileSync(".cache/console-evidence/fixture.json", JSON.stringify(fixture))
    }
  } finally {
    if (!process.env.DROP_CONSOLE_KEEP_FIXTURE || !succeeded)
      for (const person of fixture) db.prepare("DELETE FROM user WHERE id=?").run(person.id)
    db.close()
  }
})
