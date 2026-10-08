import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

test("migration seeds member counts and tombstones from existing accounts and failed deletions", () => {
  const database = new DatabaseSync(":memory:")
  const migrate = name => database.exec(readFileSync(new URL(`../../server/databases/migrations/${name}.sql`, import.meta.url), "utf8"))
  try {
    for (const name of ["0000_init", "0001_security_constraints", "0002_oauth_provider"]) migrate(name)
    database.exec("INSERT INTO user (id, name, email) VALUES ('first', 'First', 'first@example.com'), ('second', 'Second', 'second@example.com')")
    database.exec("INSERT INTO blob_cleanup (id, blob_key, created_at) VALUES ('failed', 'formerly-private.md', 1)")
    database.exec(`INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at, supersedes_id)
      VALUES ('old', 'first', 'markdown', 'Old', 'old.md', 'browser', 'First', 1, 1, NULL),
        ('current', 'first', 'markdown', 'Current', 'current.md', 'browser', 'First', 2, 2, 'old')`)
    migrate("0003_content_gates")
    assert.equal(database.prepare("SELECT members FROM workspace_stats WHERE id = 1").get().members, 2)
    assert.equal(database.prepare("SELECT blob_key FROM blob_tombstones").get().blob_key, "formerly-private.md")
    assert.equal(database.prepare("SELECT drop_id FROM drop_heads").get().drop_id, "current")
    database.exec("UPDATE drops SET updated_at = 3 WHERE id = 'current'")
    assert.equal(database.prepare("SELECT updated_at FROM drop_heads").get().updated_at, 3)
    database.exec("DELETE FROM drops WHERE id = 'current'")
    assert.equal(database.prepare("SELECT drop_id FROM drop_heads").get().drop_id, "old")
    database.exec("DELETE FROM drops WHERE id = 'old'")
    assert.equal(database.prepare("SELECT count(*) AS n FROM drop_heads").get().n, 0)
    database.exec("DELETE FROM blob_cleanup")
    assert.equal(database.prepare("SELECT count(*) AS n FROM blob_tombstones").get().n, 1)
    database.exec("DELETE FROM user")
    assert.equal(database.prepare("SELECT members FROM workspace_stats WHERE id = 1").get().members, 0)
  }
  finally { database.close() }
})
