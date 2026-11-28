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
    viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["capital"] } })
    send.mockClear()
    viewer.receive({ type: "comark-quiz:answer", detail: answer })
    await vi.waitFor(() => assert.equal(send.mock.calls.length, 1))
    const order = fetch.mock.calls[0][1].body.order
    assert.equal(order.sequence, 1)
    assert.match(order.session, /^[\da-f-]{36}$/)
    assert.ok(Number.isSafeInteger(order.issuedAt) && order.issuedAt > 0)
    assert.deepEqual(fetch.mock.calls, [
      ["/api/drops/quiz/answers", { method: "POST", query: { v: 1 }, body: { ...answer, order } }],
    ])
    assert.deepEqual(send.mock.calls[0][0].detail.answers.capital, { choice: ["rome"], correct: true })
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})

for (const staleFails of [false, true]) {
  test(`reversed save completions ignore a stale ${staleFails ? "failure" : "success"}`, async () => {
    const scope = effectScope()
    const first = Promise.withResolvers()
    const second = Promise.withResolvers()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const fail = vi.fn()
    vi.stubGlobal("watch", watch)
    vi.stubGlobal("useNotify", () => ({ fail }))
    vi.stubGlobal("$fetch", fetch)
    try {
      const drop = ref({ id: "quiz", link: "quiz", version: 1, quiz: { answers: {}, results: {} } })
      const send = vi.fn()
      const viewer = scope.run(() => useViewerQuiz(drop, send))
      viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
      send.mockClear()
      const vote = (choice) => ({
        type: "comark-quiz:answer",
        detail: { id: "lunch", kind: "poll", choice, correct: null },
      })
      viewer.receive(vote(["pizza"]))
      viewer.receive(vote(["tacos"]))
      const saved = { answer: { choice: ["tacos"], correct: null }, results: { counts: { tacos: 1 }, total: 1 } }
      second.resolve(saved)
      await vi.waitFor(() => assert.equal(send.mock.calls.length, 1))
      if (staleFails) first.reject(new Error("Delayed failure"))
      else first.resolve({ answer: { choice: ["pizza"], correct: null }, results: { counts: { pizza: 1 }, total: 1 } })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(fail.mock.calls.length, 0)
      assert.equal(send.mock.calls.length, 1)
      viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
      assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, saved.answer)
      assert.deepEqual(send.mock.lastCall[0].detail.results.lunch, saved.results)
      const orders = fetch.mock.calls.map((call) => call[1].body.order)
      assert.equal(orders[0].session, orders[1].session)
      assert.ok(orders[1].issuedAt > orders[0].issuedAt)
      assert.deepEqual(
        orders.map((order) => order.sequence),
        [1, 2],
      )
    } finally {
      scope.stop()
      vi.unstubAllGlobals()
    }
  })
}

test("a failed vote restores the last confirmed vote, and old pages cannot update the next doc", async () => {
  const scope = effectScope()
  const pending = Promise.withResolvers()
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ answer: { choice: ["pizza"], correct: null } })
    .mockRejectedValueOnce(new Error("Failed vote"))
    .mockReturnValueOnce(pending.promise)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useNotify", () => ({ fail: vi.fn() }))
  vi.stubGlobal("$fetch", fetch)
  try {
    const drop = ref({ id: "quiz", link: "quiz", version: 1, quiz: { answers: {}, results: {} } })
    const send = vi.fn()
    const viewer = scope.run(() => useViewerQuiz(drop, send))
    const vote = (choice) => ({
      type: "comark-quiz:answer",
      detail: { id: "lunch", kind: "poll", choice, correct: null },
    })
    viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
    viewer.receive(vote(["pizza"]))
    await vi.waitFor(() => assert.equal(send.mock.calls.length, 2))
    viewer.receive(vote(["tacos"]))
    await vi.waitFor(() => assert.equal(send.mock.calls.length, 3))
    assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, { choice: ["pizza"], correct: null })
    viewer.receive(vote(["tacos"]))
    drop.value = { id: "other", link: "other", version: 1, quiz: { answers: {}, results: {} } }
    await new Promise((resolve) => setImmediate(resolve))
    pending.resolve({ answer: { choice: ["tacos"], correct: null } })
    await new Promise((resolve) => setImmediate(resolve))
    viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
    assert.deepEqual(send.mock.lastCall[0].detail.answers, {})
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})

for (const earlierCompletesFirst of [false, true]) {
  test(`an older pending vote confirms ${earlierCompletesFirst ? "before" : "after"} the newest vote fails`, async () => {
    const scope = effectScope()
    const first = Promise.withResolvers()
    const second = Promise.withResolvers()
    vi.stubGlobal("watch", watch)
    vi.stubGlobal("useNotify", () => ({ fail: vi.fn() }))
    vi.stubGlobal("$fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    try {
      const before = { choice: ["tacos"], correct: null }
      const beforeResults = { counts: { tacos: 1 }, total: 1 }
      const drop = ref({
        id: "quiz",
        link: "quiz",
        version: 1,
        quiz: { answers: { lunch: before }, results: { lunch: beforeResults } },
      })
      const send = vi.fn()
      const viewer = scope.run(() => useViewerQuiz(drop, send))
      const vote = (choice) => ({
        type: "comark-quiz:answer",
        detail: { id: "lunch", kind: "poll", choice, correct: null },
      })
      viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
      viewer.receive(vote(["pizza"]))
      viewer.receive(vote([]))
      const saved = { answer: { choice: ["pizza"], correct: null }, results: { counts: { pizza: 1 }, total: 1 } }
      if (earlierCompletesFirst) {
        first.resolve(saved)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(send.mock.calls.length, 1, "the newer vote is still pending")
      }
      second.reject(new Error("Failed newest vote"))
      await vi.waitFor(() => assert.equal(send.mock.calls.length, 2))
      assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, earlierCompletesFirst ? saved.answer : before)
      first.resolve(saved)
      await new Promise((resolve) => setImmediate(resolve))
      viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
      assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, saved.answer)
      assert.deepEqual(send.mock.lastCall[0].detail.results.lunch, saved.results)
      assert.equal(
        send.mock.calls.length,
        earlierCompletesFirst ? 3 : 4,
        "confirmations push corrected state immediately",
      )
    } finally {
      scope.stop()
      vi.unstubAllGlobals()
    }
  })
}

test("a voter's note goes with their vote, and the saved note comes back to the page", async () => {
  const scope = effectScope()
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ answer: { choice: ["tacos"], correct: null, note: "Spicy" } })
    .mockRejectedValueOnce(new Error("Failed vote"))
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useNotify", () => ({ fail: vi.fn() }))
  vi.stubGlobal("$fetch", fetch)
  try {
    const saved = { choice: ["pizza"], correct: null, note: "Thin crust" }
    const drop = ref({ id: "quiz", link: "quiz", version: 1, quiz: { answers: { lunch: saved }, results: {} } })
    const send = vi.fn()
    const viewer = scope.run(() => useViewerQuiz(drop, send))
    viewer.receive({ type: "comark-quiz:ready", detail: { ids: ["lunch"] } })
    assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, saved, "the field restores from the saved note")
    const vote = (note) => ({
      type: "comark-quiz:answer",
      detail: { id: "lunch", kind: "poll", choice: ["tacos"], correct: null, note },
    })
    viewer.receive(vote("Spicy"))
    assert.deepEqual(fetch.mock.calls[0][1].body.note, "Spicy")
    await vi.waitFor(() =>
      assert.deepEqual(send.mock.lastCall[0].detail.answers.lunch, { choice: ["tacos"], correct: null, note: "Spicy" }),
    )
    const sent = send.mock.calls.length
    viewer.receive(vote("Mild"))
    await vi.waitFor(() => assert.equal(send.mock.calls.length, sent + 1))
    assert.deepEqual(
      send.mock.lastCall[0].detail.answers.lunch,
      { choice: ["tacos"], correct: null, note: "Spicy" },
      "a failed edit puts the saved note back",
    )
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})
