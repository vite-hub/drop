import type { H3Event } from "h3"
import { defineRealtime } from "vite-hub/realtime"
import { draftDocument } from "../live-drafts/realtime"

/**
 * Live editing of a Markdown drop: one room per draft (`drafts/<drop id>.md`), stored as one Blob file
 * (server/live-drafts/realtime.ts). `auth` binds presence to the signed-in person (agents have tokens, not sessions,
 * so they can't join); `authorize` admits only people who may edit that drop. The Workspace events channel every
 * editor opens (`documentId` null) carries no text, so a session is enough for it. Rooms save on their own, 2 s after
 * the last edit, every 10 s while people keep typing, and when the last person leaves.
 */
export default defineRealtime({
  auth: true,
  async authorize({ event: hostEvent, documentId }) {
    if (documentId === null) return true
    // SAFETY: on Nitro, ViteHub's host event is the request's H3Event, which findDrop and identify read.
    const event = hostEvent as H3Event
    const [{ draftDropId }, { findDrop, liveEditable, versionsOf }, { identify }] = await Promise.all([
      import("../utils/draft-paths"), import("../utils/drops"), import("../utils/identity"),
    ])
    const id = draftDropId(documentId)
    const drop = id ? await findDrop(id, event) : null
    return Boolean(drop && liveEditable(drop, await identify(event), await versionsOf(drop)))
  },
  document: draftDocument,
})
