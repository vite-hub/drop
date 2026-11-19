import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"

const origin = process.env.DROP_SESSION_TEST_ORIGIN
const database = process.env.DROP_SESSION_TEST_DATABASE
const day = 24 * 60 * 60 * 1000

// A local server with email sign-in and its SQLite file, never a shared deployment or database.
test.skipIf(!origin || !database)(
  "extending a session also renews the browser's cookie",
  async () => {
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
    const db = new DatabaseSync(database)
    const signup = await fetch(new URL("/api/auth/sign-up/email", origin), {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Session",
        email: `session-${crypto.randomUUID()}@example.test`,
        password: "local-session-refresh-test-password",
      }),
    })
    assert.equal(signup.status, 200, await signup.clone().text())
    const userId = (await signup.json()).user.id
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const created = await fetch(new URL("/api/drops", origin), {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ filename: "session.md", content: "# Session" }),
    })
    assert.equal(created.status, 200, await created.clone().text())
    const { id, slug } = await created.json()
    // Six days in, the next request is due to extend the session.
    const aged = Date.now() + day

    // Opening a drop and an API call both read the session on the server, not through /api/auth/get-session.
    for (const path of [`/d/${id}/${slug}`, "/api/me"]) {
      db.prepare("UPDATE session SET expires_at = ? WHERE user_id = ?").run(aged, userId)
      const response = await fetch(new URL(path, origin), { headers: { origin, cookie }, redirect: "manual" })
      await response.body?.cancel()
      assert.equal(response.status, 200, path)
      const { expires_at: expiresAt } = db.prepare("SELECT expires_at FROM session WHERE user_id = ?").get(userId)
      assert.ok(expiresAt > aged + 5 * day, `${path} extends the session in the database`)
      const renewed = response.headers.getSetCookie().find((value) => /session_token=/.test(value))
      assert.ok(renewed, `${path} sends the extended session's cookie`)
      const maxAge = Number(renewed.match(/Max-Age=(\d+)/i)?.[1])
      assert.ok(maxAge * 1000 > 6 * day, `${path} renews the cookie for the session's new lifetime`)
    }
  },
  120_000,
)
