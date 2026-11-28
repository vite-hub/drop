import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { canvasViewHash, canvasViewOn } from "../../app/utils/canvas-view.ts"

test("a canvas view in the address names the version it was taken on", () => {
  assert.equal(canvasViewHash("@v-a,120,-40,150z", 3), "#@v-a,120,-40,150z,v3")
  assert.equal(canvasViewHash("", 3), "", "a fitted canvas leaves the address bare")
})

test("a canvas view opens only on its own version", () => {
  assert.equal(canvasViewOn("#@v-a,120,-40,150z,v3", 3), "#@v-a,120,-40,150z")
  assert.equal(canvasViewOn("#@v-a,120,-40,150z,v3", 4), null, "a newer version opens fitted")
  assert.equal(canvasViewOn("#@v-a,120,-40,150z", 3), null, "a view with no version opens fitted")
  assert.equal(canvasViewOn("#@v%20a,1,2,100z,v3", 3), "#@v a,1,2,100z", "a percent-encoded id reads as typed")
  assert.equal(canvasViewOn("#v-a", 3), null)
})
