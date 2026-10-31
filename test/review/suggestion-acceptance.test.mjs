import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event } from "h3"
import { installComments } from "vite-hub/comments"
import { migrate, reset, sql, state, threads, who } from "../cost/harness.mjs"

const { comments } = await import("../../server/comments.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: acceptSuggestion } = await import("../../server/api/comments/[id]/accept.post.ts")
const { createDocDrop, deleteDrop, findDrop, readText } = await import("../../server/utils/drops.ts")

migrate()
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "browser" }
})

function post(path, id, body) {
  const event = new H3Event(
    new Request(`https://drop.example/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  event.context.log = { set() {}, error() {}, warn() {} }
  event.context.params = { id }
  return event
}

const accept = (id) => acceptSuggestion(post(`comments/${id}/accept`, id))

async function suggestion(body = "Count twelve pigeons.", replacement = "fifteen") {
  const doc = await createDocDrop(state.who, {
    filename: "plan.md",
    bytes: new TextEncoder().encode(body),
  })
  const comment = await commentsPost(
    post(`drops/${doc.id}/comments`, doc.id, {
      kind: "text",
      selector: "p",
      ox: 0,
      oy: 0,
      quote: "twelve",
      suggestion: replacement,
      label: 'p "Count twelve pigeons."',
    }),
  )
  return { doc, comment }
}

for (const replacement of ["fifteen", ""]) {
  test(`acceptance retries only resolution after publication and a Comments outage (${JSON.stringify(replacement)})`, async () => {
    const { doc, comment } = await suggestion(undefined, replacement)
    sql.exec(`CREATE TRIGGER fail_suggestion_resolution BEFORE UPDATE ON vitehub_comment_threads
      WHEN NEW.status = 'resolved' BEGIN SELECT RAISE(ABORT, 'Comments unavailable'); END`)
    try {
      await assert.rejects(accept(comment.id), (error) => error.cause?.message === "Comments unavailable")
      assert.equal((await findDrop(doc.id)).version, 2, "publication committed before resolution failed")
      assert.equal(threads()[0].status, "open")
      assert.equal(
        sql.prepare("SELECT version FROM suggestion_acceptances WHERE thread_id = ?").get(comment.id).version,
        2,
      )
    } finally {
      sql.exec("DROP TRIGGER fail_suggestion_resolution")
    }
    // A process restart and a later ordinary edit must not lose which suggestion already published.
    installComments(comments, { database: state.db })
    await createDocDrop(state.who, {
      filename: doc.filename,
      bytes: new TextEncoder().encode("A later edit."),
      supersedes: doc.id,
    })
    const retried = await accept(comment.id)
    assert.equal(retried.version, 3, "retry must not publish another version")
    assert.equal(await readText((await findDrop(doc.id)).blobKey), "A later edit.")
    assert.equal(threads()[0].status, "resolved")
    assert.equal(threads()[0].resolved_by, JSON.stringify({ id: who.userId, name: who.name }))
  })
}

test("retry after a resolution outage does not reapply a quote that still occurs elsewhere", async () => {
  const { doc, comment } = await suggestion("Count twelve pigeons.\n\nThe roof holds twelve.")
  sql.exec(`CREATE TRIGGER fail_suggestion_resolution BEFORE UPDATE ON vitehub_comment_threads
    WHEN NEW.status = 'resolved' BEGIN SELECT RAISE(ABORT, 'Comments unavailable'); END`)
  try {
    await assert.rejects(accept(comment.id))
  } finally {
    sql.exec("DROP TRIGGER fail_suggestion_resolution")
  }
  state.who = { ...who, userId: "someone-else", actorKind: "browser" }
  await assert.rejects(accept(comment.id), { status: 404 }, "a receipt does not bypass edit permission")
  state.who = { ...who, actorKind: "browser" }
  assert.equal((await accept(comment.id)).version, 2)
  assert.equal(await readText((await findDrop(doc.id)).blobKey), "Count fifteen pigeons.\n\nThe roof holds twelve.")
  assert.equal(threads()[0].status, "resolved")
  await deleteDrop(await findDrop(doc.id))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM suggestion_acceptances").get().n, 0)
})

test("failure to record acceptance rolls back the published version and allows a clean retry", async () => {
  const { doc, comment } = await suggestion()
  sql.exec(`CREATE TRIGGER fail_acceptance_receipt BEFORE INSERT ON suggestion_acceptances
    BEGIN SELECT RAISE(ABORT, 'Receipt unavailable'); END`)
  try {
    await assert.rejects(accept(comment.id))
    assert.equal((await findDrop(doc.id)).version, 1)
    assert.equal(await readText((await findDrop(doc.id)).blobKey), "Count twelve pigeons.")
    assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_versions").get().n, 0)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM suggestion_acceptances").get().n, 0)
    assert.equal(threads()[0].status, "open")
  } finally {
    sql.exec("DROP TRIGGER fail_acceptance_receipt")
  }
  assert.equal((await accept(comment.id)).version, 2)
  assert.equal(threads()[0].status, "resolved")
})

test("concurrent acceptance requests cannot publish the same suggestion twice", async () => {
  const { doc, comment } = await suggestion()
  const attempts = await Promise.allSettled([accept(comment.id), accept(comment.id)])
  assert.ok(attempts.some((attempt) => attempt.status === "fulfilled"))
  assert.equal((await findDrop(doc.id)).version, 2)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM suggestion_acceptances").get().n, 1)
  assert.equal(threads()[0].status, "resolved")
})
