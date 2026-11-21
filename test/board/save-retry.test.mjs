import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { useIntervalFn, useRafFn, useTimeoutFn } from "@vueuse/core"
import { test, vi } from "vite-plus/test"
import { ref } from "vue"
import { saveRetryDelay } from "../../app/utils/backoff.ts"

test("a board save that keeps failing waits twice as long each time, then keeps trying once a minute", () => {
  const delays = [1, 2, 3, 4, 5, 6, 20].map((failures) => saveRetryDelay(failures))
  assert.deepEqual(delays, [5000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
})

for (const status of [429, 503, 403, 413])
  test(`board sync ${status}: retries transient failures and parks permanent refusals`, async () => {
    const source = readFileSync(new URL("../../app/components/viewer/ViewerBoard.vue", import.meta.url), "utf8")
    const syncSource = source.slice(source.indexOf("function sync("), source.indexOf("</script>"))
    const code = ts.transpileModule(syncSource, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
    vi.useFakeTimers()
    const unsaved = { value: undefined }
    const post = vi.fn().mockRejectedValueOnce({ status }).mockResolvedValue({})
    const scene = [{ id: "one", version: 1 }]
    const api = { getSceneElementsIncludingDeleted: () => scene, getSceneElements: () => [] }
    const sync = new Function(
      "props",
      "saving",
      "unsaved",
      "$fetch",
      "reportClientError",
      "httpStatus",
      "errorText",
      "saveRetryDelay",
      "window",
      "document",
      "requestAnimationFrame",
      "ref",
      "useTimeoutFn",
      "useIntervalFn",
      "useRafFn",
      `${code}; return sync`,
    )(
      { drop: { id: "board" } },
      {},
      unsaved,
      (_url, options) => (options?.method === "POST" ? post() : Promise.resolve({ snapshot: { elements: [] } })),
      () => {},
      (error) => error.status,
      () => "refused",
      saveRetryDelay,
      { addEventListener() {}, removeEventListener() {} },
      { hidden: false },
      () => {},
      ref,
      useTimeoutFn,
      useIntervalFn,
      useRafFn,
    )
    const board = sync({}, api, [], true)
    board.onChange(scene)
    await vi.advanceTimersByTimeAsync(700)
    assert.equal(post.mock.calls.length, 1)
    assert.ok(unsaved.value)
    // Selection/pointer callbacks carry the same versions and must neither postpone nor restart a save.
    for (let n = 0; n < 120; n++) {
      board.onChange(scene)
      await vi.advanceTimersByTimeAsync(1000)
    }
    const transient = status === 429 || status === 503
    assert.equal(post.mock.calls.length, transient ? 2 : 1)
    assert.equal(unsaved.value === undefined, transient)
    board.stop()
    await vi.advanceTimersByTimeAsync(0)
  })
