import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { mediaSpotFor, readMediaSpots, saveMediaSpot } from "../../app/lib/media-resume.client.ts"
import { startTime } from "../../shared/video-time.ts"

const SOURCE = "https://drop.test/clip.webm"
const OTHER = "https://drop.test/other.webm"

beforeEach(() => {
  const data = new Map()
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
})

test("a drop keeps where each of its players stopped", () => {
  saveMediaSpot("a1", 0, SOURCE, 42.37, 150)
  saveMediaSpot("a1", 1, OTHER, 8, 30)
  assert.equal(mediaSpotFor(readMediaSpots("a1"), 0, SOURCE, 150), 42.4)
  assert.equal(mediaSpotFor(readMediaSpots("a1"), 1, OTHER, 31), 8)
  assert.deepEqual(readMediaSpots("b2"), {})
})

test("near either end there's nothing to resume", () => {
  saveMediaSpot("a1", 0, SOURCE, 42, 150)
  saveMediaSpot("a1", 0, SOURCE, 147, 150)
  assert.deepEqual(readMediaSpots("a1"), {})
  saveMediaSpot("a1", 0, SOURCE, 42, 150)
  saveMediaSpot("a1", 0, SOURCE, 3, 150)
  assert.deepEqual(readMediaSpots("a1"), {})
})

test("a spot requires the same source and length", () => {
  saveMediaSpot("a1", 0, SOURCE, 12, 20)
  saveMediaSpot("a1", 0, OTHER, 0, 20)
  const spots = readMediaSpots("a1")
  assert.equal(mediaSpotFor(spots, 0, SOURCE, 20), 12)
  assert.equal(mediaSpotFor(spots, 0, OTHER, 20), undefined)
  assert.equal(mediaSpotFor(spots, 0, SOURCE, 95), undefined)
})

test("a valid timestamp including zero overrides a saved spot", () => {
  saveMediaSpot("a1", 0, SOURCE, 12, 20)
  const saved = mediaSpotFor(readMediaSpots("a1"), 0, SOURCE, 20)
  for (const [value, expected] of [
    [undefined, 12],
    ["invalid", 12],
    ["0", 0],
    ["0:00", 0],
    ["8", 8],
  ]) {
    assert.equal(startTime(value) ?? saved, expected)
  }
})
