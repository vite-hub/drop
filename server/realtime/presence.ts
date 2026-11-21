import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"

export default defineRealtime({
  async origins({ event, request, origin }) {
    const { presenceOrigin } = await import("../utils/presence")
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which the presence checks read.
    return presenceOrigin(event as H3Event, request, origin)
  },
  async identify({ event, request }) {
    const { presenceIdentity } = await import("../utils/presence")
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which the presence checks read.
    return presenceIdentity(event as H3Event, request)
  },
  async authorize({ event, request, documentId, mode, user }) {
    if (!user) return false
    const { presenceAllows } = await import("../utils/presence")
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which the presence checks read.
    return presenceAllows(event as H3Event, request, documentId, mode)
  },
  document: false,
})
