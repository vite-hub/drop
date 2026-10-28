import assert from "node:assert/strict"
import { runInNewContext, Script } from "node:vm"
import { test } from "vite-plus/test"
const { parseFrameMessage } = await import("../../shared/frame-messages.ts")
const { QUIZ_BRIDGE } = await import("../../shared/plan-runtime.ts")
const { planDocument } = await import("../../shared/documents.ts")

const message = (body) => parseFrameMessage({ __drop: true, ...body })
const answer = (fields) => message({ type: "quiz-answer", answer: fields })

test("the frame's quiz messages carry block ids, option keys, and how a recall card went, within limits", () => {
  assert.deepEqual(message({ type: "quiz-ready", ids: ["capital", "lunch"] }), {
    type: "quiz-ready",
    ids: ["capital", "lunch"],
  })
  assert.deepEqual(answer({ id: "capital", kind: "question", choice: ["paris", "paris"], correct: true }), {
    type: "quiz-answer",
    answer: { id: "capital", kind: "question", choice: ["paris"], correct: true },
  })
  assert.deepEqual(answer({ id: "lunch", kind: "poll", choice: [] }).answer, {
    id: "lunch",
    kind: "poll",
    choice: [],
    correct: null,
  })
  assert.deepEqual(answer({ id: "card", kind: "recall", choice: ["knew"], correct: null, first: true }).answer, {
    id: "card",
    kind: "recall",
    choice: ["knew"],
    correct: null,
  })
  for (const fields of [
    { id: "", kind: "question", choice: ["a"] },
    { id: "x".repeat(101), kind: "question", choice: ["a"] },
    { id: "q", kind: "question", choice: [] },
    { id: "q", kind: "question", choice: ["k".repeat(65)] },
    { id: "q", kind: "poll", choice: Array.from({ length: 21 }, (_, n) => `k${n}`) },
    { id: "q", kind: "poll", choice: [1] },
    { id: "q", kind: "recall", choice: ["knew", "missed"] },
    { id: "q", kind: "recall", choice: ["maybe"] },
    { id: "q", kind: "survey", choice: ["a"] },
  ])
    assert.equal(answer(fields), null, JSON.stringify(fields))
  assert.equal(message({ type: "quiz-ready", ids: Array.from({ length: 201 }, (_, n) => `q${n}`) }), null)
  assert.equal(parseFrameMessage({ type: "quiz-ready", ids: [] }), null, "only Drop's runtimes' messages")
})

/** QUIZ_BRIDGE in a page of its own: what it posts up, and the state events it fires on the document. */
function bridge() {
  const posted = []
  const states = []
  let onMessage
  // Copied out of the sandbox, whose objects have its own prototypes.
  const parent = { postMessage: (data) => posted.push(JSON.parse(JSON.stringify(data))) }
  const document = new EventTarget()
  document.addEventListener("comark-quiz:state", (event) => states.push(event.detail))
  runInNewContext(QUIZ_BRIDGE, {
    parent,
    document,
    CustomEvent,
    addEventListener: (type, handler) => type === "message" && (onMessage = handler),
  })
  return {
    posted,
    states,
    fire: (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })),
    receive: (data, source = parent) => onMessage({ source, data }),
  }
}

test("the bridge forwards answers and the blocks on the page, and hands the blocks the viewer's state", () => {
  const page = bridge()
  const state = { answers: { capital: { choice: ["paris"], correct: true } }, voting: { open: false } }
  // The viewer may answer before the blocks' script starts: the state comes again once it does.
  page.receive({ __drop: true, type: "quiz-state", state })
  page.fire("comark-quiz:ready", { ids: ["capital", "lunch"] })
  assert.deepEqual(page.posted, [{ __drop: true, type: "quiz-ready", ids: ["capital", "lunch"] }])
  assert.deepEqual(page.states, [state, state])

  page.fire("comark-quiz:answer", {
    id: "lunch",
    kind: "poll",
    choice: ["pizza"],
    correct: null,
    first: true,
    node: { not: "sent" },
  })
  page.fire("comark-quiz:answer", { id: 7, kind: "question", choice: "paris", correct: "yes" })
  assert.deepEqual(page.posted.slice(1), [
    { __drop: true, type: "quiz-answer", answer: { id: "lunch", kind: "poll", choice: ["pizza"], correct: null } },
    { __drop: true, type: "quiz-answer", answer: { id: "", kind: "question", choice: [], correct: null } },
  ])
  assert.equal(parseFrameMessage(page.posted[2]), null, "a malformed answer goes no further than the viewer")

  // Only the parent's state messages count.
  page.receive({ __drop: true, type: "quiz-state", state: { voting: { open: true } } }, {})
  page.receive({ type: "quiz-state", state: { voting: { open: true } } })
  page.receive({ __drop: true, type: "quiz-state", state: { voting: { open: true } } })
  assert.deepEqual(page.states.slice(2), [{ voting: { open: true } }])
})

test("only Markdown docs get the bridge, first in the head, before the blocks' own script", () => {
  const doc = planDocument("markdown", "# Quiz", false, '<div data-quiz-id="q"></div><script>start()</script>')
  const at = doc.indexOf(QUIZ_BRIDGE)
  assert.ok(at > 0 && at < doc.indexOf("</head>") && at < doc.indexOf("start()"))
  assert.doesNotThrow(() => new Script(QUIZ_BRIDGE))
  assert.equal(planDocument("html", "<html><head></head><body></body></html>").includes(QUIZ_BRIDGE), false)
})
