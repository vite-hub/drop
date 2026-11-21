import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"

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
