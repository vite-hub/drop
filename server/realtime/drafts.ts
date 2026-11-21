import type { H3Event } from "h3"
import { blob } from "vite-hub/blob"
import { defineRealtime } from "vite-hub/realtime"
import { blobDocument } from "vite-hub/realtime/server"
import { draftOf } from "#shared/draft-paths"
import { liveEditor } from "../utils/live-editor"

export default defineRealtime({
  async authorize({ event: hostEvent, documentId, user }) {
    if (!user) return false
    if (documentId === null) return true
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which findDrop and identify read.
    const event = hostEvent as H3Event
    const [{ findDrop, liveEditable }, { identify }, { requestLog }] = await Promise.all([
      import("../utils/drops"),
      import("../utils/identity"),
      import("../utils/logs"),
    ])
    const draft = draftOf(documentId)
    const drop = draft ? await findDrop(draft.id, event) : null
    const refused = !drop
      ? "not-found"
      : drop.version !== draft!.version
        ? "old-version"
        : !liveEditable(drop, await identify(event))
          ? "not-editable"
          : null
    if (refused) requestLog(event)?.set({ roomAccess: { refused } })
    return !refused
  },
  document: blobDocument(blob),
  editor: liveEditor,
})
