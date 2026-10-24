import assert from "node:assert/strict"
import { H3Event } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, migrate, reset, sql, state, who } from "../cost/harness.mjs"
const { answersOf, quizBlocks, quizResults, recordAnswer } = await import("../../server/utils/answers.ts")
const { cachedMarkdown } = await import("../../server/utils/markdown-cache.ts")
const { MAX_QUIZ_BLOCKS } = await import("../../shared/quiz.ts")
const { default: answersPost } = await import("../../server/api/drops/[id]/answers.post.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")

migrate()
beforeEach(() => {
  reset()
  if (sql.prepare("SELECT 1 FROM sqlite_master WHERE name = 'drop_answers'").get()) sql.exec("DELETE FROM drop_answers")
})

const ada = { ...who, userId: "ada", name: "Ada", email: "ada@example.com", actorName: "Ada" }
const bob = { ...who, userId: "bob", name: "Bob", email: "bob@example.com", actorName: "Bob" }

// What comark-quiz renders, as far as Drop reads it: each block's id and kind, and its options' keys.
const QUIZ_HTML = [
  '<div class="quiz" data-quiz-id="capital" data-quiz-kind="question"><p>Capital of France?</p>',
  '<button data-key="paris">Paris</button><button data-key="lyon">Lyon</button></div>',
  '<div data-quiz-kind="poll" data-quiz-id="lunch"><button data-key="pizza">Pizza</button>',
  '<button data-key="tacos">Tacos</button></div>',
  '<div data-quiz-id="photosynthesis" data-quiz-kind="recall"><p>What is photosynthesis?</p></div>',
  "<p>Written <code>data-key=&quot;fake&quot;</code> in the text.</p>",
].join("")

/** A Markdown doc whose render holds the quiz, as if the server had rendered it with comark-quiz. */
async function quizDoc(id, overrides) {
  insertDrop(id, overrides)
  await cachedMarkdown(
    `${id}.md`,
    async () => "# Quiz",
    async () => ({ title: "Quiz", html: QUIZ_HTML }),
  )
}

function post(id, body) {
  const event = new H3Event(
    new Request(`https://drop.example/api/drops/${id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  event.context.log = { set() {}, error() {} }
  event.context.params = { id }
  return answersPost(event)
}

function detail(id) {
  const event = new H3Event(new Request(`https://drop.example/api/drops/${id}`))
  event.context.log = { set() {}, error() {} }
  event.context.params = { id }
  return detailHandler(event)
}

const status = (expected) => (error) => error.status === expected

test("a database without the answers table gets it on the first read, index and triggers included", async () => {
  assert.equal(sql.prepare("SELECT 1 FROM sqlite_master WHERE name = 'drop_answers'").get(), undefined)
  assert.deepEqual(await answersOf("doc", "ada"), [])
  assert.deepEqual(
    sql
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'drop_answers%' ORDER BY name")
      .all()
      .map((row) => row.name),
    ["drop_answers", "drop_answers_drop_delete", "drop_answers_user_delete", "drop_answers_user_idx"],
  )
})

test("a reader's first answer stays beside their latest; results count first tries and current votes, recall none", async () => {
  let now = 1
  const record = (link, userId, answer) => recordAnswer(link, userId, { correct: null, ...answer }, now++)
  await record("doc", "ada", { id: "capital", kind: "question", choice: ["lyon"], correct: false })
  await record("doc", "ada", { id: "capital", kind: "question", choice: ["paris"], correct: true })
  await record("doc", "bob", { id: "capital", kind: "question", choice: ["paris"], correct: true })
  await record("doc", "ada", { id: "lunch", kind: "poll", choice: ["pizza"] })
  await record("doc", "ada", { id: "lunch", kind: "poll", choice: ["tacos", "pizza"] })
  await record("doc", "bob", { id: "lunch", kind: "poll", choice: ["pizza"] })
  // Took the vote back: not one of the people the poll counts.
  await record("doc", "cy", { id: "lunch", kind: "poll", choice: [] })
  await record("doc", "ada", { id: "photosynthesis", kind: "recall", choice: ["knew"] })
  await record("other", "ada", { id: "capital", kind: "question", choice: ["paris"], correct: true })

  assert.deepEqual(Object.fromEntries(await quizResults("doc")), {
    capital: { kind: "question", counts: { lyon: 1, paris: 1 }, total: 2 },
    lunch: { kind: "poll", counts: { pizza: 2, tacos: 1 }, total: 2 },
  })
  assert.deepEqual(await answersOf("doc", "ada"), [
    {
      id: "capital",
      kind: "question",
      first: { choice: ["lyon"], correct: false },
      latest: { choice: ["paris"], correct: true },
      attempts: 2,
      answeredAt: 2,
    },
    {
      id: "lunch",
      kind: "poll",
      first: { choice: ["pizza"], correct: null },
      latest: { choice: ["tacos", "pizza"], correct: null },
      attempts: 2,
      answeredAt: 5,
    },
    {
      id: "photosynthesis",
      kind: "recall",
      first: { choice: ["knew"], correct: null },
      latest: { choice: ["knew"], correct: null },
      attempts: 1,
      answeredAt: 8,
    },
  ])
  assert.deepEqual([...(await quizResults("doc", { answeredBy: "cy" })).keys()], ["lunch"])
  assert.deepEqual([...(await quizResults("doc", { question: "capital" })).keys()], ["capital"])
  assert.deepEqual([...(await quizResults("doc", { answeredBy: "nobody" })).keys()], [])
})

test("a doc keeps answers to a limited number of blocks, and the ones it has keep taking answers", async () => {
  const answer = (id) => ({ id, kind: "poll", choice: ["a"], correct: null })
  for (let n = 0; n < MAX_QUIZ_BLOCKS; n++) assert.equal(await recordAnswer("doc", "ada", answer(`q${n}`)), true)
  assert.equal(await recordAnswer("doc", "ada", answer("one-more")), false)
  assert.equal(await recordAnswer("doc", "bob", answer("q0")), true)
  assert.equal(await recordAnswer("another-doc", "ada", answer("one-more")), true)
  assert.equal((await quizResults("doc")).has("one-more"), false)
})

test("deleting a doc's last version, or a person, deletes the answers that went with them", async () => {
  insertDrop("v1", { link: "doc" })
  insertDrop("v2", { link: "doc", supersedes_id: "v1", version: 2 })
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('ada', 'Ada', 'ada@example.com')").run()
  await recordAnswer("doc", "ada", { id: "capital", kind: "question", choice: ["paris"], correct: true })
  await recordAnswer("doc", "bob", { id: "capital", kind: "question", choice: ["lyon"], correct: false })
  sql.exec("DELETE FROM user WHERE id = 'ada'")
  assert.deepEqual(await answersOf("doc", "ada"), [])
  sql.exec("DELETE FROM drops WHERE id = 'v2'")
  assert.equal((await answersOf("doc", "bob")).length, 1, "an earlier version keeps them")
  sql.exec("DELETE FROM drops WHERE id = 'v1'")
  assert.deepEqual(await answersOf("doc", "bob"), [])
})

test("a rendered doc's blocks are read with their kind and the keys of their own options", () => {
  const blocks = quizBlocks(QUIZ_HTML)
  assert.deepEqual([...blocks.keys()], ["capital", "lunch", "photosynthesis"])
  assert.deepEqual(blocks.get("capital"), { kind: "question", keys: new Set(["paris", "lyon"]) })
  assert.deepEqual(blocks.get("lunch"), { kind: "poll", keys: new Set(["pizza", "tacos"]) })
  assert.deepEqual(blocks.get("photosynthesis"), { kind: "recall", keys: new Set() })
  assert.deepEqual(
    quizBlocks('<div data-quiz-id="a&amp;b" data-quiz-kind="poll"><i data-key="&quot;x&quot;"></i></div>').get("a&b"),
    { kind: "poll", keys: new Set(['"x"']) },
  )
})

test("people who aren't signed in get a 401 and nothing is kept, though the doc is public", async () => {
  await quizDoc("quiz", { visibility: "public", access: "view" })
  state.who = null
  await assert.rejects(post("quiz", { id: "capital", kind: "question", choice: ["paris"], correct: true }), status(401))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_answers").get()?.n ?? 0, 0)
})

test("a signed-in reader's answer is checked against the doc, kept, and comes back with that block's results", async () => {
  await quizDoc("quiz", { visibility: "public", access: "view" })
  state.who = ada
  assert.deepEqual(await post("quiz", { id: "capital", kind: "question", choice: ["lyon"], correct: false }), {
    answer: { choice: ["lyon"], correct: false },
    results: { counts: { lyon: 1 }, total: 1 },
  })
  assert.deepEqual(state.bursts.at(-1), { bucket: "quiz-answer", key: "quiz:ada", limit: 30, window: "1m" })
  // A second try is the latest answer; the results keep the first.
  assert.deepEqual(await post("quiz", { id: "capital", kind: "question", choice: ["paris"], correct: true }), {
    answer: { choice: ["paris"], correct: true },
    results: { counts: { lyon: 1 }, total: 1 },
  })
  state.who = bob
  assert.deepEqual(await post("quiz", { id: "lunch", kind: "poll", choice: ["tacos", "tacos"] }), {
    answer: { choice: ["tacos"], correct: null },
    results: { counts: { tacos: 1 }, total: 1 },
  })
  assert.deepEqual(await post("quiz", { id: "photosynthesis", kind: "recall", choice: ["missed"], correct: null }), {
    answer: { choice: ["missed"], correct: null },
  })

  for (const body of [
    { id: "elsewhere", kind: "question", choice: ["paris"], correct: true },
    { id: "capital", kind: "question", choice: ["marseille"], correct: false },
    { id: "capital", kind: "question", choice: ["fake"], correct: false },
    { id: "capital", kind: "poll", choice: ["paris"] },
    { id: "lunch", kind: "recall", choice: ["knew"] },
  ])
    await assert.rejects(post("quiz", body), status(400), JSON.stringify(body))
  for (const body of [
    { id: "capital", kind: "question", choice: [], correct: true },
    { id: "photosynthesis", kind: "recall", choice: ["maybe"] },
    { id: "x".repeat(101), kind: "poll", choice: ["a"] },
    { id: "lunch", kind: "poll", choice: Array.from({ length: 21 }, (_, n) => `k${n}`) },
  ])
    await assert.rejects(post("quiz", body), status(400), "the body doesn't validate")

  state.who = { ...ada, actorKind: "agent", actorName: "Claude Code" }
  await assert.rejects(post("quiz", { id: "lunch", kind: "poll", choice: ["pizza"] }), status(403))
  assert.deepEqual(Object.fromEntries(await quizResults("quiz")), {
    capital: { kind: "question", counts: { lyon: 1 }, total: 1 },
    lunch: { kind: "poll", counts: { tacos: 1 }, total: 1 },
  })
})

test("only people who can open the doc answer, and not while it's in the Trash", async () => {
  await quizDoc("mine", { visibility: "private" })
  state.who = ada
  await assert.rejects(post("mine", { id: "lunch", kind: "poll", choice: ["pizza"] }), status(404))
  state.who = who
  sql.prepare("UPDATE drops SET trashed_at = 1, trash_reason = 'deleted' WHERE id = 'mine'").run()
  await assert.rejects(post("mine", { id: "lunch", kind: "poll", choice: ["pizza"] }), status(403))
  insertDrop("page", { kind: "html", filename: "page.html", blob_key: "page.html" })
  await assert.rejects(post("page", { id: "lunch", kind: "poll", choice: ["pizza"] }), status(403))
})

test("the drop's page carries the reader's answers and the results of only the blocks they answered", async () => {
  await quizDoc("quiz", { visibility: "public", access: "view" })
  await recordAnswer("quiz", "ada", { id: "capital", kind: "question", choice: ["lyon"], correct: false })
  await recordAnswer("quiz", "ada", { id: "capital", kind: "question", choice: ["paris"], correct: true })
  await recordAnswer("quiz", "bob", { id: "capital", kind: "question", choice: ["paris"], correct: true })
  await recordAnswer("quiz", "bob", { id: "lunch", kind: "poll", choice: ["pizza"], correct: null })
  await recordAnswer("quiz", "ada", { id: "photosynthesis", kind: "recall", choice: ["knew"], correct: null })

  state.who = ada
  assert.deepEqual((await detail("quiz")).quiz, {
    answers: {
      capital: { choice: ["paris"], correct: true },
      photosynthesis: { choice: ["knew"], correct: null },
    },
    results: { capital: { counts: { lyon: 1, paris: 1 }, total: 2 } },
  })
  state.who = { ...who, userId: "cy", name: "Cy", email: "cy@example.com" }
  assert.deepEqual((await detail("quiz")).quiz, { answers: {}, results: {} }, "signed in, nothing answered yet")
  state.who = null
  assert.equal((await detail("quiz")).quiz, undefined, "a guest's answers don't count")
  state.who = { ...ada, actorKind: "agent", actorName: "Claude Code" }
  assert.equal((await detail("quiz")).quiz, undefined, "agents read answers through read_drop")
})
