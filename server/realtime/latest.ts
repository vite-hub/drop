import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"

/**
 * The latest version of each doc, for the people reading it: one read-only room per drop (`documentId` is its id, the
 * share link's key), whose digest is the drop's latest version number. Publishing a version calls `refreshLatest()`
 * (server/utils/drops/write.ts), which re-seeds the room, so every open viewer learns the new number at once and
 * follows it unless they're busy (useLatestVersion). Nobody writes to these rooms and they never save.
 *
 * Whoever may open the link may join its room, people and visitors alike. The Workspace events channel every client
 * also opens (`documentId` null) carries nothing here; Drop ignores it.
 */
export default defineRealtime({
  async authorize({ event: hostEvent, documentId, mode }) {
    if (documentId === null && mode !== "write") return true
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which findDrop and identify read.
    const event = hostEvent as H3Event
    const [{ expiredLink, findDrop, permissions, waitingForReview }, { identify }, { requestLog }] = await Promise.all([
      import("../utils/drops"),
      import("../utils/identity"),
      import("../utils/logs"),
    ])
    // ViteHub's `realtime` says the room refused (`refused: "authorize"`); `roomAccess` says which of Drop's rules did.
    const refuse = (refused: string) => {
      requestLog(event)?.set({ roomAccess: { refused } })
      return false
    }
    if (mode === "write") return refuse("write")
    if (documentId === null) return true
    const [head, who] = await Promise.all([findDrop(documentId, event), identify(event)])
    if (!head) return refuse("not-found")
    if (!(permissions(head, who).view || waitingForReview(head, who) || expiredLink(head, who)))
      return refuse("no-access")
    return true
  },
  document: {
    kind: "drop-latest",
    async load({ documentId }) {
      const { findDrop } = await import("../utils/drops")
      const head = await findDrop(documentId)
      return { body: "", digest: head ? String(head.version) : null }
    },
    save() {
      throw new Error("The latest version of a doc changes by publishing, not through its room.")
    },
  },
  persistence: false,
})
