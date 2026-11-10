import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { computed, effectScope, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue"
import { useIdle } from "@vueuse/core"
import { usePresence } from "../../app/composables/usePresence.ts"

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock("@vite-hub/realtime/client", () => ({ connectRealtimeRoom: connect }))
afterEach(() => vi.unstubAllGlobals())

test("frame input wakes a reviewer and restarts the idle deadline, while a hidden tab stays away", async () => {
  vi.useFakeTimers()
  const frameHost = new EventTarget()
  frameHost.document = Object.assign(new EventTarget(), { hidden: false })
  const visibility = ref("visible")
  const room = {
    destroy: vi.fn(),
    onUpdate: vi.fn(),
    setLocal: vi.fn(),
    states: () => new Map(),
    people: () => [],
  }
  connect.mockReturnValue(room)
  for (const [name, value] of Object.entries({
    computed,
    onScopeDispose,
    ref,
    shallowRef,
    watch,
    useRuntimeConfig: () => ({ public: { realtime: true } }),
    useMe: () => ({ data: ref({ id: "ada", name: "Ada" }) }),
    useMounted: () => ref(true),
    useLocalStorage: () => ref(true),
    useIdle: (timeout) => useIdle(timeout, { window: frameHost }),
    useDocumentVisibility: () => visibility,
    $fetch: async () => ({ room: "doc-room" }),
  }))
    vi.stubGlobal(name, value)

  const scope = effectScope()
  try {
    const presence = scope.run(() => usePresence(ref({ id: "doc" }), { at: () => "v1", enabled: () => true }))
    await vi.dynamicImportSettled()
    assert.deepEqual(room.setLocal.mock.calls[0], ["active", true])
    await vi.advanceTimersByTimeAsync(60_000)
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", false])

    presence.activity()
    await nextTick()
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", true])
    await vi.advanceTimersByTimeAsync(59_000)
    presence.activity()
    await vi.advanceTimersByTimeAsync(59_000)
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", true])
    await vi.advanceTimersByTimeAsync(1000)
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", false])

    visibility.value = "hidden"
    presence.activity()
    await nextTick()
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", false])
    visibility.value = "visible"
    await nextTick()
    assert.deepEqual(room.setLocal.mock.lastCall, ["active", true])
  } finally {
    scope.stop()
  }
})
