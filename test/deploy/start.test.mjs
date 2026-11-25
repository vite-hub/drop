import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { test } from "vite-plus/test"
import { migrations } from "../../scripts/migrations.mjs"
import { databasePath } from "../../scripts/start.mjs"

const entries = migrations()

test("an older missing migration applies to a database with pins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drop-start-"))
  const file = join(dir, "drop.db")
  const db = new DatabaseSync(file)
  const handoffs = entries.find(({ name }) => name === "0017_comment_sends.sql")
  // Indexes the tables 0017 creates, so a database without 0017 lacks it too.
  const liveKey = entries.find(({ name }) => name === "0020_comment_sends_live_key.sql")
  assert.ok(handoffs && liveKey)
  const pins = "SELECT user_id, drop_id, at FROM drop_pins"
  const sends = "SELECT count(*) AS n FROM vitehub_comment_sends"
  const recorded = 'SELECT name FROM "__drizzle_migrations" WHERE name = ?'
  try {
    db.exec(
      'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)',
    )
    for (const entry of entries) {
      if (entry === handoffs || entry === liveKey) continue
      db.exec(entry.sql)
      db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES (?, ?, ?)').run(
        createHash("sha256").update(entry.sql).digest("hex"),
        entry.when,
        entry.tag,
      )
    }
    db.exec(`INSERT INTO user (id, name, email) VALUES ('reader', 'Reader', 'reader@example.com');
      INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at)
      VALUES ('doc', 'reader', 'markdown', 'Existing doc', 'doc.md', 'browser', 'Reader', 1, 1);
      INSERT INTO drop_pins (user_id, drop_id, at) VALUES ('reader', 'doc', 42);`)

    const run = (query, params, rowMode) => {
      const statement = db.prepare(query)
      if (!statement.columns().length) return statement.run(...params)
      statement.setReturnArrays(rowMode !== "object")
      return statement.all(...params)
    }
    const migrator = drizzle({
      get: async (query, params, rowMode) => run(query, params, rowMode)[0],
      all: async (query, params, rowMode) => run(query, params, rowMode),
      run: async (query, params) => run(query, params),
    })
    await migrate(migrator, async (statements) => db.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`), {
      migrationsFolder: fileURLToPath(new URL("../../server/databases/default/migrations/", import.meta.url)),
    })
    assert.ok(db.prepare(recorded).get(handoffs.tag))
    assert.ok(db.prepare(recorded).get(liveKey.tag))
    assert.equal(db.prepare(sends).get().n, 0)
    assert.deepEqual({ ...db.prepare(pins).get() }, { user_id: "reader", drop_id: "doc", at: 42 })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("database paths read like libSQL's file: URLs", () => {
  assert.equal(databasePath(), resolve(".data/database/drop.db"))
  assert.equal(databasePath("file:///var/drop/drop.db"), "/var/drop/drop.db")
  assert.equal(databasePath("file:data/drop.db?mode=rwc"), resolve("data/drop.db"))
  assert.equal(databasePath("file:.data/database/my%20drop.db"), resolve(".data/database/my drop.db"))
  assert.equal(databasePath("file:/app/.data/my%20drop.db"), "/app/.data/my drop.db")
  assert.throws(() => databasePath("libsql://example.turso.io"), /file: URL/)
})
