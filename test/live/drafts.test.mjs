import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { objects, state } from "../cost/harness.mjs"
const { deleteDrafts, ensureDraft, readDraft } = await import("../../server/utils/live-drafts.ts")

const ID = { id: "3f1c7a520000", version: 2 }
const PATH = "drafts/3f1c7a520000/v2.md"

beforeEach(() => objects.clear())

test("a draft starts from the published body, and opening it again keeps the room's text", async () => {
  assert.equal(await ensureDraft(ID, "# Plan\n"), PATH)
  assert.equal(await readDraft(ID), "# Plan\n")
  await state.blob.put(PATH, "# Plan\n\nEdited.\n")
  await ensureDraft(ID, "# Plan\n")
  assert.equal(await readDraft(ID), "# Plan\n\nEdited.\n")
})

test("publishing deletes the draft", async () => {
  await ensureDraft(ID, "# Plan\n")
  await deleteDrafts([ID])
  assert.equal(await readDraft(ID), null)
  assert.equal(objects.size, 0)
})
