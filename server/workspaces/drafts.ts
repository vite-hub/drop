import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { defineWorkspace } from "vite-hub/workspace"
import { createBlobDatabaseWorkspaceStore } from "vite-hub/workspace/blob-database"

/**
 * Live drafts of Markdown drops, one file per drop at `drafts/<drop id>.md`, without its front matter. Realtime
 * rooms (server/realtime/drops.ts) load from and checkpoint into these files; publishing turns one into the next
 * version. Bytes live in BLOB under `vitehub/workspace-history`, manifests in the `workspace_history_*` tables.
 */
export default defineWorkspace({
  store: createBlobDatabaseWorkspaceStore({ blob, database: db, workspace: "drafts" }),
  rules: {
    "drafts/**": { write: true, mediaType: "text/markdown" },
  },
})
