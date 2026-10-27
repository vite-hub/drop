import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { effectScope, ref, watch } from "vue"
import { useViewerQuiz } from "../../app/composables/useViewerQuiz.ts"

test("the viewer saves an answer for the version the reader has open", async () => {
  const scope = effectScope()
  const answer = { id: "capital", kind: "question", choice: ["rome"], correct: true }
  const fetch = vi.fn().mockResolvedValue({ answer: { choice: ["rome"], correct: true } })
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useNotify", () => ({ fail: vi.fn() }))
  vi.stubGlobal("$fetch", fetch)
  try {
    const drop = ref({ id: "quiz", link: "quiz", version: 1, quiz: { answers: {}, results: {} } })
    const send = vi.fn()
    const viewer = scope.run(() => useViewerQuiz(drop, send))
    viewer.receive({ type: "quiz-ready", ids: ["capital"] })
    send.mockClear()
    viewer.receive({ type: "quiz-answer", answer })
    await vi.waitFor(() => assert.equal(send.mock.calls.length, 1))
    assert.deepEqual(fetch.mock.calls, [["/api/drops/quiz/answers", { method: "POST", query: { v: 1 }, body: answer }]])
    assert.deepEqual(send.mock.calls[0][0].state.answers.capital, { choice: ["rome"], correct: true })
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})
