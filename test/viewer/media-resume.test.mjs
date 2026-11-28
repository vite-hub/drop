import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { mediaSpotFor, readMediaSpots, saveMediaSpot } from "../../app/lib/media-resume.client.ts"

beforeEach(() => {
  const data = new Map()
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
})

test("a drop keeps where each of its players stopped", () => {
  saveMediaSpot("a1", 0, 42.37, 150)
  saveMediaSpot("a1", 1, 8, 30)
  assert.equal(mediaSpotFor(readMediaSpots("a1"), 0, 150), 42.4)
  assert.equal(mediaSpotFor(readMediaSpots("a1"), 1, 30.4), 8)
  assert.deepEqual(readMediaSpots("b2"), {})
})

test("near either end there's nothing to resume", () => {
  saveMediaSpot("a1", 0, 42, 150)
  saveMediaSpot("a1", 0, 148, 150)
  assert.deepEqual(readMediaSpots("a1"), {})
  saveMediaSpot("a1", 0, 42, 150)
  saveMediaSpot("a1", 0, 1, 150)
  assert.deepEqual(readMediaSpots("a1"), {})
})

test("a spot only fits a player of the same length", () => {
  saveMediaSpot("a1", 0, 42, 150)
  assert.equal(mediaSpotFor(readMediaSpots("a1"), 0, 95), undefined)
})
