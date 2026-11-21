import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { effectScope, nextTick, ref, shallowRef, watch } from "vue"

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock("vite-hub/realtime/client", () => ({ connectRealtimeRoom: connect }))
afterEach(() => {
  vi.unstubAllGlobals()
  connect.mockReset()
})

/** A room of the latest-version definition, whose save status the test sets as the server would. */
function fakeRoom() {
  let status
  const listeners = new Set()
  return {
    destroy: vi.fn(() => listeners.clear()),
    onUpdate: (listener) => listeners.add(listener),
    saveStatus: () => status,
    seed(digest) {
      status = digest === undefined ? undefined : { digest, savedAt: null, savedBy: null, error: null, issues: [] }
      for (const listener of listeners) listener()
    },
  }
}

test("a reader follows the digest of the link's latest room through the editor-free room client", async () => {
  for (const [name, value] of Object.entries({ ref, shallowRef, watch })) vi.stubGlobal(name, value)
  const rooms = []
  connect.mockImplementation(() => rooms[rooms.push(fakeRoom()) - 1])
  const { useLatestRoom } = await import("../../app/composables/latest-room.ts")
  const link = ref("abc")
  const enabled = ref(true)
  const scope = effectScope()
  const latest = scope.run(() =>
    useLatestRoom(
      () => link.value,
      () => enabled.value,
    ),
  )
  try {
    assert.deepEqual(connect.mock.calls, [["latest", "abc"]])
    assert.equal(latest.value, 0, "nothing until the room syncs")
    rooms[0].seed("3")
    assert.equal(latest.value, 3)
    // Publishing re-seeds the room: the status is gone while the client joins the new seed, then reads the new one.
    rooms[0].seed(undefined)
    assert.equal(latest.value, 0)
    rooms[0].seed("4")
    assert.equal(latest.value, 4)

    link.value = "def"
    await nextTick()
    assert.equal(rooms[0].destroy.mock.calls.length, 1, "it leaves the old link's room")
    assert.deepEqual(connect.mock.lastCall, ["latest", "def"])
    assert.equal(latest.value, 0)

    enabled.value = false
    await nextTick()
    assert.equal(rooms[1].destroy.mock.calls.length, 1, "following off leaves the room")
    assert.equal(connect.mock.calls.length, 2)
    enabled.value = true
    await nextTick()
    assert.equal(connect.mock.calls.length, 3)
  } finally {
    scope.stop()
  }
  assert.equal(rooms[2].destroy.mock.calls.length, 1, "leaving the scope leaves the room")
})
