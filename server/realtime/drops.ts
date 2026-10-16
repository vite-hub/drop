import { defineRealtime } from "vite-hub/realtime"

/**
 * Live editing of a Markdown drop: one room per draft (`drafts/<drop id>.md`). `auth` binds presence to the signed-in
 * person (agents have tokens, not sessions, so they can't join); `authorize` admits only people who may edit that drop.
 * The Workspace events channel every editor opens carries draft paths, never text, so a session is enough for it.
 */
export default defineRealtime({
  auth: true,
  async authorize({ event, documentId, workspaceEvents }) {
    if (workspaceEvents) return true
    const [{ draftDropId }, { findDrop, liveEditable, versionsOf }, { identify }] = await Promise.all([
      import("../utils/draft-paths"), import("../utils/drops"), import("../utils/identity"),
    ])
    const id = draftDropId(documentId)
    const drop = id ? await findDrop(id, event) : null
    return Boolean(drop && liveEditable(drop, await identify(event), await versionsOf(drop)))
  },
  document: { workspace: "drafts" },
  history: { checkpoint: { message: "Live edit" } },
})
