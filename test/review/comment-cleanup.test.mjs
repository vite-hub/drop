import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { installComments } from "vite-hub/comments"
import { insertDrop, migrate, reset, sql, state, threads } from "../cost/harness.mjs"

const { comments } = await import("../../server/comments.ts")
const { deleteDrop, deleteExpiredDrops, findDrop } = await import("../../server/utils/drops.ts")

migrate()
beforeEach(reset)

async function thread(dropId, scope = `drop:${dropId}`) {
  const [error, created] = await comments.create({
    scope,
    page: `/d/${dropId}`,
    body: "Remove this comment with its drop",
    author: { id: "owner", name: "Owner" },
    metadata: {
      dropId,
      version: 1,
      kind: "page",
      selector: "",
      ox: 0,
      oy: 0,
      ow: 0,
      oh: 0,
      quote: null,
      label: null,
      page: null,
      elementX: null,
      elementY: null,
    },
  })
  assert.ifError(error)
  return created
}

for (const kind of ["markdown", "site"]) {
  test(`failed ${kind} comment cleanup survives deletion and retries without its Drop rows`, async () => {
    insertDrop("parent", { kind })
    const scope = `${kind === "site" ? "site" : "drop"}:parent`
    const first = await thread("parent", scope)
    assert.ifError((await comments.reply(first.id, { body: "A reply", author: { id: "owner", name: "Owner" } }))[0])
    insertDrop("child", { kind: "image", parent_id: "parent" })
    await thread("child", kind === "site" ? scope : "drop:child")
    sql.exec(`CREATE TRIGGER fail_comment_cleanup BEFORE DELETE ON vitehub_comment_threads
      BEGIN SELECT RAISE(ABORT, 'Comments unavailable'); END`)
    try {
      await deleteDrop(await findDrop("parent"))
      assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 0)
      assert.equal(threads().length, 2)
      assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_cleanup").get().n, 2)
    } finally {
      sql.exec("DROP TRIGGER fail_comment_cleanup")
    }
    // Reinstall the primitive as at process start; only the database holds pending work.
    installComments(comments, { database: state.db })
    assert.equal(await deleteExpiredDrops(new Date()), 0)
    assert.deepEqual(threads(), [])
    assert.equal(sql.prepare("SELECT count(*) AS n FROM vitehub_comments").get().n, 0)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_cleanup").get().n, 0)
  })
}

for (const count of [1, 501]) {
  test(`screenshot deletion removes ${count} older threads beyond the site's 500-thread list`, async () => {
    insertDrop("site", { kind: "site" })
    insertDrop("shot", { kind: "image", parent_id: "site" })
    for (let index = 0; index < count; index++) await thread("shot", "site:site")
    for (let index = 0; index < 500; index++) await thread("site", "site:site")
    // Make the activity ordering unambiguous even when writes share a millisecond.
    sql.exec("UPDATE vitehub_comment_threads SET updated_at = 1 WHERE json_extract(metadata, '$.dropId') = 'shot'")
    await deleteDrop(await findDrop("shot"))
    assert.equal(await findDrop("shot"), null)
    assert.equal(threads().length, 500)
    assert.ok(threads().every((item) => item.metadata.dropId === "site"))
  })
}

test("failure to queue comment cleanup rolls back the Drop deletion", async () => {
  insertDrop("doc")
  await thread("doc")
  sql.exec(`CREATE TRIGGER fail_comment_queue BEFORE INSERT ON comment_cleanup
    BEGIN SELECT RAISE(ABORT, 'Queue unavailable'); END`)
  try {
    await assert.rejects(deleteDrop(await findDrop("doc")))
    assert.ok(await findDrop("doc"))
    assert.equal(threads().length, 1)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM blob_cleanup").get().n, 0)
  } finally {
    sql.exec("DROP TRIGGER fail_comment_queue")
  }
})

test("cleanup can retry after primitive deletion succeeds but acknowledging the queue fails", async () => {
  insertDrop("doc")
  await thread("doc")
  sql.exec(`CREATE TRIGGER fail_comment_ack BEFORE DELETE ON comment_cleanup
    BEGIN SELECT RAISE(ABORT, 'Queue acknowledgement unavailable'); END`)
  try {
    await deleteDrop(await findDrop("doc"))
    assert.equal(await findDrop("doc"), null)
    assert.deepEqual(threads(), [])
    assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_cleanup").get().n, 1)
  } finally {
    sql.exec("DROP TRIGGER fail_comment_ack")
  }
  await deleteExpiredDrops(new Date())
  assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_cleanup").get().n, 0)
})
