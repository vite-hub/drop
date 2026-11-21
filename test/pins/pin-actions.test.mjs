import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { computed, effectScope, ref, toRef } from "vue"
import { keys } from "../../app/utils/keys"

vi.stubGlobal("keys", keys)
const { useDropActions, useDropPin, usePinned } = await import("../../app/composables/useDrops")
vi.unstubAllGlobals()

afterEach(() => vi.unstubAllGlobals())

function setup(data, fetch) {
  const state = new Map()
  const refresh = vi.fn()
  vi.stubGlobal("useNuxtApp", () => ({ payload: { data } }))
  vi.stubGlobal("useNuxtData", (key) => ({ data: toRef(data, key) }))
  vi.stubGlobal("useState", (key, init) => {
    if (!state.has(key)) state.set(key, ref(init()))
    return state.get(key)
  })
  vi.stubGlobal("keys", keys)
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("useNotify", () => ({ say: vi.fn(), fail: vi.fn() }))
  vi.stubGlobal("useConfirm", () => undefined)
  vi.stubGlobal("useSiteDialog", () => undefined)
  vi.stubGlobal("effectScope", effectScope)
  vi.stubGlobal("refreshNuxtData", refresh)
  vi.stubGlobal("$fetch", fetch)
  return refresh
}

test("card actions reflect confirmed writes through failed or stale list refreshes", async () => {
  const doc = { id: "doc" }
  const other = { id: "other", pinned: true }
  const data = { [keys.pinned]: [other] }
  const refresh = setup(data, vi.fn())
  vi.stubGlobal("useApi", (_, options) => options)
  const { transform } = usePinned()
  const pin = useDropPin(() => doc)
  const otherPin = useDropPin(() => ({ id: "other" }))
  const { setPinned } = useDropActions()
  refresh.mockImplementation(() => Promise.resolve())

  assert.equal(pin.value, false)
  await setPinned(doc, true)
  assert.equal(pin.value, true)
  assert.deepEqual(data[keys.pinned], [other])
  assert.equal(otherPin.value, true)
  const pinned = { ...doc, pinned: true }
  data[keys.pinned] = transform([pinned, other])
  const pinnedCard = useDropPin(() => pinned)
  await setPinned(doc, false)
  data[keys.pinned] = transform([pinned, other])
  assert.equal(pin.value, false)
  assert.equal(pinnedCard.value, false)
  data[keys.pinned] = transform([other])
  assert.equal(otherPin.value, true)
  assert.equal(pin.value, false)
})

test("confirmed pin and unpin update the current and archived viewers", async () => {
  const data = {
    [keys.drop("doc")]: { id: "doc", version: 2 },
    [keys.drop("doc", 1)]: { id: "doc", version: 1 },
    [keys.drop("other", 1)]: { id: "other", version: 1 },
  }
  const fetch = vi.fn()
  const refresh = setup(data, fetch)
  const { setPinned } = useDropActions()
  for (const pinned of [true, false]) {
    assert.equal(await setPinned(data[keys.drop("doc", 1)], pinned), true)
    assert.equal(data[keys.drop("doc")].pinned, pinned)
    assert.deepEqual(data[keys.drop("doc", 1)], { id: "doc", version: 1, pinned })
    assert.equal(data[keys.drop("other", 1)].pinned, undefined)
    assert.deepEqual(fetch.mock.lastCall, ["/api/drops/doc/pin", { method: pinned ? "PUT" : "DELETE" }])
    assert.deepEqual(refresh.mock.lastCall, [keys.pinned])
  }
})

test("same-drop writes cannot overlap across controls and a failure leaves other pins alone", async () => {
  const slow = Promise.withResolvers()
  const existing = { id: "existing", pinned: true }
  const other = { id: "other", pinned: true }
  const data = { [keys.pinned]: [existing], [keys.drop("doc")]: { id: "doc" } }
  const fetch = vi.fn().mockReturnValueOnce(slow.promise)
  const refresh = setup(data, fetch)
  refresh.mockImplementation(() => (data[keys.pinned] = [other, existing]))
  const doc = data[keys.drop("doc")]
  const inFlight = useDropActions().setPinned(doc, true)
  assert.equal(doc.pinned, undefined)
  assert.equal(await useDropActions().setPinned(doc, false), false)
  assert.equal(fetch.mock.calls.length, 1)
  assert.equal(await useDropActions().setPinned(other, true), true)
  slow.reject(new Error("Write rejected"))
  assert.equal(await inFlight, false)
  assert.deepEqual(data[keys.pinned], [other, existing])
  assert.equal(data[keys.drop("doc")].pinned, undefined)
  assert.equal(await useDropActions().setPinned(doc, true), true)
})
