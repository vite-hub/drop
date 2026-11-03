import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
const { parseFrameMessage } = await import("../../shared/frame-messages.ts")
const { planDocument } = await import("../../shared/documents.ts")

const answer = (detail) => parseFrameMessage({ type: "comark-quiz:answer", detail })

test("comark-quiz's relayed messages carry block ids, option keys, and how a recall card went, within limits", () => {
  assert.deepEqual(parseFrameMessage({ type: "comark-quiz:ready", detail: { ids: ["capital", "lunch"] } }), {
    type: "comark-quiz:ready",
    detail: { ids: ["capital", "lunch"] },
  })
  assert.deepEqual(
    answer({ id: "capital", kind: "question", choice: ["paris", "paris"], correct: true, first: true }),
    {
      type: "comark-quiz:answer",
      detail: { id: "capital", kind: "question", choice: ["paris"], correct: true },
    },
  )
  assert.deepEqual(answer({ id: "lunch", kind: "poll", choice: [] }).detail, {
    id: "lunch",
    kind: "poll",
    choice: [],
    correct: null,
  })
  assert.deepEqual(answer({ id: "card", kind: "recall", choice: ["knew"], correct: null }).detail, {
    id: "card",
    kind: "recall",
    choice: ["knew"],
    correct: null,
  })
  for (const fields of [
    { id: "", kind: "question", choice: ["a"] },
    { id: 7, kind: "question", choice: ["a"] },
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
  const ids = Array.from({ length: 201 }, (_, n) => `q${n}`)
  assert.deepEqual(parseFrameMessage({ type: "comark-quiz:ready", detail: { ids } }).detail.ids, ids.slice(0, 200))
  assert.equal(parseFrameMessage({ type: "quiz-ready", ids: [] }), null, "only Drop's runtimes' own messages")
  assert.equal(parseFrameMessage({ type: "selection", clear: true }), null, "unmarked, only comark-quiz's")
})

test("a Markdown doc tells comark-quiz to relay to the viewer's origin, and no other kind does", () => {
  vi.stubGlobal("location", { origin: "https://drop.example" })
  try {
    const doc = planDocument("markdown", "# Quiz", false, '<div data-quiz-id="q"></div>')
    assert.match(doc, /<html lang="en" data-quiz-relay="https:\/\/drop\.example"/)
    assert.doesNotMatch(planDocument("html", "<html><head></head><body></body></html>"), /data-quiz-relay/)
  } finally {
    vi.unstubAllGlobals()
  }
})
