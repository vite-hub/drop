import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { dropBackfills } from "../../scripts/comments-migration.mjs"

const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
const file = "20261103143224_0011_comments_one_model/migration.sql"

test("review retry claims follow the replacement thread table", () => {
  const database = beforeMove()
  try {
    seed(database)
    database.exec(`
      UPDATE vitehub_comment_threads SET metadata = json_set(metadata, '$.requestId', 'old-request') WHERE id = 't4';
      INSERT INTO review_submissions VALUES ('site:site', 'old-request', 't4');
    `)
    database.exec(readFileSync(new URL(file, directory), "utf8"))
    assert.equal(
      database.prepare("SELECT thread_id FROM review_submissions WHERE request_id = 'old-request'").get().thread_id,
      "t4",
    )
    assert.equal(database.prepare("PRAGMA foreign_key_list(review_submissions)").get().table, "vitehub_comment_threads")
    const insert = database.prepare(`
      INSERT INTO vitehub_comment_threads
        (id, scope, n, subject_kind, subject_id, anchor, status, author_id, metadata, created_at, updated_at)
      VALUES (?, 'site:site', ?, 'site', 'site', '{"kind":"page"}', 'open', 'ana', ?, 1, 1)
    `)
    assert.throws(() => insert.run("duplicate-old", 5, json({ requestId: "old-request" })), /UNIQUE/)
    insert.run("new-thread", 5, json({ requestId: "new-request" }))
    assert.equal(
      database.prepare("SELECT thread_id FROM review_submissions WHERE request_id = 'new-request'").get().thread_id,
      "new-thread",
    )
    assert.throws(() => insert.run("duplicate-new", 6, json({ requestId: "new-request" })), /UNIQUE/)
    database.exec("DELETE FROM vitehub_comment_threads WHERE id IN ('t4', 'new-thread')")
    assert.equal(database.prepare("SELECT count(*) AS n FROM review_submissions").get().n, 0)
    assert.equal(database.prepare("SELECT count(*) AS n FROM vitehub_comment_threads_live WHERE id = 't4'").get().n, 1)
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
  } finally {
    database.close()
  }
})

/** Drop's database just before the move: every migration up to the comments move, as production has them. */
function beforeMove() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(directory) })) {
    if (migration.sql.join("").includes("vitehub_comment_threads_live")) break
    database.exec(migration.sql.join(";\n"))
  }
  return database
}

const json = (value) => JSON.stringify(value)
const meta = (fields) => ({
  dropId: "doc",
  version: 1,
  kind: "text",
  selector: "#intro > p",
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  quote: "old words",
  suggestion: null,
  emptyBody: false,
  label: null,
  page: null,
  elementX: null,
  elementY: null,
  ...fields,
})

/** Threads as Drop wrote them with ViteHub 0.1.0: `drop:<id>` and `site:<id>` scopes, Drop's anchor in metadata. */
function seed(database) {
  const thread = database.prepare(
    "INSERT INTO vitehub_comment_threads (id, scope, number, page, anchor, status, resolved_by, resolved_at, created_by, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, 'null', ?, ?, ?, ?, ?, ?, ?)",
  )
  const comment = database.prepare(
    "INSERT INTO vitehub_comments (id, thread_id, body, mentions, author, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const ana = json({ id: "ana", name: "Ana", image: "https://example.com/ana.png" })
  const guest = json({ id: "guest:1", name: "Visitor", guest: true })
  database.exec(`
    INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at)
      VALUES ('doc', 'ana', 'markdown', 'Doc', 'doc.md', 'browser', 'Ana', 1, 1),
             ('site', 'ana', 'site', 'Site', 'site', 'browser', 'Ana', 1, 1),
             ('img-1', 'ana', 'image', 'one.png in comment #1', 'one.png', 'browser', 'Ana', 1, 1),
             ('img-2', 'ana', 'image', 'two.png in comment #1', 'two.png', 'browser', 'Ana', 1, 1),
             ('img-3', 'ana', 'image', 'three.png in comment #1', 'three.png', 'browser', 'Ana', 1, 1),
             ('shot', 'ana', 'image', 'Screenshot', 'screenshot.png', 'browser', 'Visitor', 1, 1);
  `)
  // #1 on v1: a text comment with two images and a reply with one. Its thread id is its first comment's, as the
  // hand conversion of 2026-11-02 left them.
  thread.run("c1", "drop:doc", 1, "/d/doc", "open", null, null, ana, json(meta({})), 10, 30)
  comment.run("c1", "c1", "Typo here", json([{ id: "bo", name: "Bo" }]), ana, 10)
  comment.run("r1", "c1", "Agreed", "[]", guest, 20)
  // #2 on v2: a suggestion without a note, saved with a stand-in body.
  thread.run(
    "t2",
    "drop:doc",
    2,
    "/d/doc",
    "resolved",
    ana,
    50,
    ana,
    json(meta({ version: 2, suggestion: "new words", emptyBody: true })),
    40,
    50,
  )
  comment.run("m2", "t2", "Suggested edit", "[]", ana, 40)
  // #4 on the site's screenshot, an area; #3 was deleted, so the site's next number is 5.
  thread.run(
    "t4",
    "site:site",
    4,
    "/pricing",
    "open",
    null,
    null,
    guest,
    json(
      meta({
        dropId: "shot",
        kind: "image",
        selector: "body > img",
        ox: 100,
        oy: 200,
        ow: 300,
        oh: 400,
        quote: "button Buy",
        label: "#buy",
      }),
    ),
    60,
    60,
  )
  comment.run("m4", "t4", "Too small", "[]", guest, 60)
  database.exec(`
    INSERT INTO vitehub_comment_scope_counters (scope, last_number) VALUES ('drop:doc', 2), ('site:site', 4)
      ON CONFLICT (scope) DO UPDATE SET last_number = excluded.last_number;
    INSERT INTO comment_attachments (drop_id, comment_id, reply_id, created_at)
      VALUES ('img-2', 'c1', NULL, 2), ('img-1', 'c1', NULL, 1), ('img-3', 'c1', 'r1', 3);
  `)
}

test("the shipped migration keeps Drop's backfills", () => {
  // Upstream's generator follows its current schema. Later schema changes belong in new migrations.
  const shipped = readFileSync(new URL(file, directory), "utf8")
  for (const statement of dropBackfills) assert.ok(shipped.includes(`${statement};`))
})

test("Drop's comments move to the one comment model with their numbers, versions, images, and anchors", () => {
  const database = beforeMove()
  try {
    seed(database)
    const counts = {
      threads: database.prepare("SELECT count(*) AS n FROM vitehub_comment_threads").get().n,
      comments: database.prepare("SELECT count(*) AS n FROM vitehub_comments").get().n,
    }
    database.exec(readFileSync(new URL(file, directory), "utf8"))

    // Nothing is lost: every thread and comment moves, and the old rows stay as the backup.
    assert.equal(database.prepare("SELECT count(*) AS n FROM vitehub_comment_threads").get().n, counts.threads)
    assert.equal(database.prepare("SELECT count(*) AS n FROM vitehub_comment_messages").get().n, counts.comments)
    assert.equal(database.prepare("SELECT count(*) AS n FROM vitehub_comment_threads_live").get().n, counts.threads)
    assert.equal(database.prepare("SELECT count(*) AS n FROM vitehub_comments").get().n, counts.comments)

    const threads = Object.fromEntries(
      database
        .prepare("SELECT * FROM vitehub_comment_threads ORDER BY id")
        .all()
        .map((row) => [row.id, { ...row, anchor: JSON.parse(row.anchor), metadata: JSON.parse(row.metadata) }]),
    )
    assert.deepEqual(
      Object.values(threads).map(({ id, scope, n, subject_kind, subject_id, status, author_id, revision }) => ({
        id,
        scope,
        n,
        subject_kind,
        subject_id,
        status,
        author_id,
        revision,
      })),
      [
        {
          id: "c1",
          scope: "drop:doc",
          n: 1,
          subject_kind: "drop",
          subject_id: "doc",
          status: "open",
          author_id: "ana",
          revision: 1,
        },
        {
          id: "t2",
          scope: "drop:doc",
          n: 2,
          subject_kind: "drop",
          subject_id: "doc",
          status: "resolved",
          author_id: "ana",
          revision: 2,
        },
        {
          id: "t4",
          scope: "site:site",
          n: 4,
          subject_kind: "site",
          subject_id: "site",
          status: "open",
          author_id: "guest:1",
          revision: 1,
        },
      ],
    )
    assert.equal(threads.t2.resolved_by, json({ id: "ana", name: "Ana", image: "https://example.com/ana.png" }))
    // Drop's anchor stays in metadata for its viewers; `version` and `emptyBody` moved into the model.
    const {
      version: _version,
      emptyBody: _emptyBody,
      ...kept
    } = meta({
      dropId: "shot",
      kind: "image",
      selector: "body > img",
      ox: 100,
      oy: 200,
      ow: 300,
      oh: 400,
      quote: "button Buy",
      label: "#buy",
    })
    assert.deepEqual(threads.t4.metadata, kept)
    assert.equal("version" in threads.c1.metadata || "emptyBody" in threads.t2.metadata, false)
    assert.equal(threads.t2.metadata.suggestion, "new words")
    // ViteHub's surfaces get the same places as anchors.
    assert.deepEqual(threads.c1.anchor, {
      kind: "text",
      selector: "#intro > p",
      exact: "old words",
      prefix: "",
      suffix: "",
    })
    assert.deepEqual(threads.t4.anchor, {
      kind: "image",
      selector: "body > img",
      x: 100,
      y: 200,
      width: 300,
      height: 400,
    })

    const messages = Object.fromEntries(
      database
        .prepare(
          "SELECT id, thread_id, body, author_id, author_name, mentions, attachments FROM vitehub_comment_messages",
        )
        .all()
        .map((row) => [
          row.id,
          { ...row, mentions: JSON.parse(row.mentions), attachments: JSON.parse(row.attachments) },
        ]),
    )
    // Mentions become ids; images follow their message in the order they were sent.
    assert.deepEqual(messages.c1, {
      id: "c1",
      thread_id: "c1",
      body: "Typo here",
      author_id: "ana",
      author_name: "Ana",
      mentions: ["bo"],
      attachments: ["img-1", "img-2"],
    })
    assert.deepEqual(messages.r1.attachments, ["img-3"])
    assert.equal(messages.r1.author_id, "guest:1")
    // The stand-in note of a suggestion is gone; a real note would have stayed.
    assert.equal(messages.m2.body, "")
    assert.deepEqual(messages.m4.attachments, [])

    // Numbers go on where each scope left off, deleted ones included.
    assert.deepEqual(
      database
        .prepare("SELECT scope, next FROM vitehub_comment_counters ORDER BY scope")
        .all()
        .map((row) => ({ ...row })),
      [
        { scope: "drop:doc", next: 3 },
        { scope: "site:site", next: 5 },
      ],
    )
    // The new table has its own indexes, not the live table's.
    assert.deepEqual(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'vitehub_comment_threads' ORDER BY name",
        )
        .all()
        .map((row) => row.name)
        .filter((name) => !name.startsWith("sqlite_")),
      ["vitehub_comment_threads_scope_n", "vitehub_comment_threads_status", "vitehub_comment_threads_subject"],
    )
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
  } finally {
    database.close()
  }
})
