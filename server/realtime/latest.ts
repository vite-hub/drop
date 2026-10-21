import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"

/**
 * The latest version of each doc, for the people reading it: one read-only room per share link (`documentId` is the
 * link's key), whose digest is the version number of the doc's head. Publishing a version calls `refreshLatest()`
 * (server/utils/drops/write.ts), which re-seeds the room, so every open viewer learns the new number at once and
 * follows it unless they're busy (useLatestVersion). Nobody writes to these rooms and they never save.
 *
 * Whoever may open the link may join its room, people and visitors alike. The Workspace events channel every client
 * also opens (`documentId` null) carries nothing here; Drop ignores it.
 */
export default defineRealtime({
  async authorize({ event: hostEvent, documentId, mode }) {
    if (mode === "write") return false
    if (documentId === null) return true
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which findDropByLink and identify read.
    const event = hostEvent as H3Event
    const [{ expiredLink, findDropByLink, permissions, waitingForReview }, { identify }] = await Promise.all([
      import("../utils/drops"),
      import("../utils/identity"),
    ])
    const [head, who] = await Promise.all([findDropByLink(documentId, undefined, event), identify(event)])
    return Boolean(head && (permissions(head, who).view || waitingForReview(head, who) || expiredLink(head, who)))
  },
  document: {
    kind: "drop-latest",
    async load({ documentId }) {
      const { findDropByLink } = await import("../utils/drops")
      const head = await findDropByLink(documentId)
      return { body: "", digest: head ? String(head.version) : null }
    },
    save() {
      throw new Error("The latest version of a doc changes by publishing, not through its room.")
    },
  },
  persistence: false,
})
