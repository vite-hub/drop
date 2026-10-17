import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { objects } from "../cost/harness.mjs"
const { deleteDrafts, draftDocument, ensureDraft, readDraft } = await import("../../server/live-drafts/realtime.ts")
const { isRealtimeDocumentConflict } = await import("vite-hub/realtime")

const ID = "3f1c7a52-0000-4000-8000-000000000000"
const room = { authority: "memory", definition: "drops", documentId: `drafts/${ID}.md` }
const saving = (ifDigest, reason = "idle") => ({ editors: [], ifDigest, reason })

beforeEach(() => objects.clear())

test("a draft starts from the published body, and opening it again keeps the room's text", async () => {
  assert.equal(await ensureDraft(ID, "# Plan\n"), room.documentId)
  const { digest } = await draftDocument.load(room)
  await draftDocument.save(room, { body: "# Plan\n\nEdited.\n" }, saving(digest))
  await ensureDraft(ID, "# Plan\n")
  assert.equal(await readDraft(ID), "# Plan\n\nEdited.\n")
})

test("a room saves only over the text it loaded", async () => {
  await ensureDraft(ID, "# Plan\n")
  const loaded = await draftDocument.load(room)
  assert.equal(loaded.body, "# Plan\n")
  const saved = await draftDocument.save(room, { body: "# Plan\n\nOne.\n" }, saving(loaded.digest))
  assert.notEqual(saved.digest, loaded.digest)
  assert.equal((await draftDocument.load(room)).digest, saved.digest)
  // A second save from the stale digest is a conflict, so Realtime reloads and resets the room instead of overwriting.
  await assert.rejects(draftDocument.save(room, { body: "# Plan\n\nTwo.\n" }, saving(loaded.digest)), isRealtimeDocumentConflict)
  assert.equal(await readDraft(ID), "# Plan\n\nOne.\n")
})

test("a published (deleted) draft loads empty, and a room that still holds it can't write it back", async () => {
  await ensureDraft(ID, "# Plan\n")
  const { digest } = await draftDocument.load(room)
  await deleteDrafts([ID])
  assert.deepEqual(await draftDocument.load(room), { body: "", digest: null })
  await assert.rejects(draftDocument.save(room, { body: "late" }, saving(digest, "leave")), isRealtimeDocumentConflict)
  assert.equal(objects.size, 0)
})
