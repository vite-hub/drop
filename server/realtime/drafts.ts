import type { H3Event } from "h3"
import { blob } from "vite-hub/blob"
import { defineRealtime } from "vite-hub/realtime"
import { blobDocument } from "vite-hub/realtime/server"
import { draftOf } from "#shared/draft-paths"
import { liveEditor } from "../utils/live-editor"

/**
 * Live editing of a Markdown drop: one room per draft (`drafts/<drop id>/v<n>.md`), stored as one Blob file
 * (server/utils/live-drafts.ts). `auth` binds presence to the signed-in person (agents have tokens, not sessions,
 * so they can't join); `authorize` admits only people who may edit that drop. The Workspace events channel every
 * editor opens (`documentId` null) carries no text, so a session is enough for it. Rooms save on their own, 2 s after
 * the last edit, every 10 s while people keep typing, and when the last person leaves. The editor is comark-ui's, so
 * components, footnotes and suggested edits stay as they are (server/utils/live-editor.ts).
 *
 * The room is named for its schema: rooms named `drops` held the plain-Markdown editor's. A new name gives every draft a
 * fresh room from its file, and a tab still on the old build can't join and delete nodes it doesn't know.
 */
export default defineRealtime({
  auth: true,
  async authorize({ event: hostEvent, documentId }) {
    if (documentId === null) return true
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which findDrop and identify read.
    const event = hostEvent as H3Event
    const [{ findDrop, liveEditable }, { identify }] = await Promise.all([
      import("../utils/drops"),
      import("../utils/identity"),
    ])
    // Only the latest version's draft: a room left open on an older one can't write over it. Its editor finds out
    // when it can't get back in (useLiveEditor).
    const draft = draftOf(documentId)
    const drop = draft ? await findDrop(draft.id, event) : null
    return Boolean(drop && drop.version === draft!.version && liveEditable(drop, await identify(event)))
  },
  document: blobDocument(blob),
  editor: liveEditor,
})
