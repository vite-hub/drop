import { defineRealtime } from "vite-hub/realtime"

/**
 * Live editing of a Markdown drop: one room per draft (`drafts/<drop id>.md`). `auth` binds presence to the
 * signed-in person; server/middleware/0.3.realtime-access.ts checks that they may edit that drop.
 */
export default defineRealtime({
  auth: true,
  document: { workspace: "drafts" },
  history: { checkpoint: { message: "Live edit" } },
})
