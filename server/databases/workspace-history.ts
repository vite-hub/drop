// The tables ViteHub's blob-database Workspace Store publishes manifests to (`workspaceHistorySchema` in
// vite-hub/workspace/blob-database), mirrored here because drizzle-kit can't load that ESM-only export.
// The drafts Workspace (server/workspaces/drafts.ts) uses them. Keep them identical when bumping vite-hub.
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const workspaceHistoryRefs = sqliteTable("workspace_history_refs", {
  workspace: text("workspace").primaryKey(),
  head: text("head"),
  sequence: integer("sequence").notNull().default(0),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
})

export const workspaceHistoryRevisions = sqliteTable("workspace_history_revisions", {
  workspace: text("workspace").notNull(),
  id: text("id").notNull(),
  parentId: text("parent_id"),
  sequence: integer("sequence").notNull(),
  createdAt: text("created_at").notNull(),
  message: text("message"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  files: integer("files").notNull(),
  bytes: integer("bytes").notNull(),
  entries: text("entries", { mode: "json" }).$type<unknown>().notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
}, table => [primaryKey({ columns: [table.workspace, table.id] }), index("workspace_history_timeline").on(table.workspace, table.published, table.sequence)])

export const workspaceHistoryObjects = sqliteTable("workspace_history_objects", {
  workspace: text("workspace").notNull(),
  digest: text("digest").notNull(),
  size: integer("size").notNull(),
}, table => [primaryKey({ columns: [table.workspace, table.digest] })])

export const workspaceHistoryMetadata = sqliteTable("workspace_history_metadata", {
  workspace: text("workspace").notNull(),
  key: text("key").notNull(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
}, table => [primaryKey({ columns: [table.workspace, table.key] })])
