import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"

/**
 * Who has a drop open, whether they're active, and where their pointer is: one room per drop, named by
 * `presenceRoom` (server/utils/presence.ts). Drop's own pages join with Drop's session; review.js joins from a reviewed
 * site with a presence ticket, the only thing a request from another origin is identified by. Only people who could
 * open the drop without its link join. The rooms hold no document: people share their state through awareness, every
 * connection is read-only, and nothing is stored.
 */
export default defineRealtime({
  auth: true,
  // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which the presence checks read.
  async origins({ event, request, origin }) {
    const { presenceOrigin } = await import("../utils/presence")
    return presenceOrigin(event as H3Event, request, origin)
  },
  async identify({ event, request }) {
    const { presenceIdentity } = await import("../utils/presence")
    return presenceIdentity(event as H3Event, request)
  },
  async authorize({ event, request, documentId, mode }) {
    const { presenceAllows } = await import("../utils/presence")
    return presenceAllows(event as H3Event, request, documentId, mode)
  },
  document: {
    kind: "drop-presence",
    load: async () => ({ body: "", digest: null }),
    save() {
      throw new Error("Presence rooms hold no document.")
    },
  },
  persistence: false,
})
