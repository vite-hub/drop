import type { AgentMetadata } from "../../../shared/agent.ts"
import { sql } from "drizzle-orm"
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ACTOR_KINDS, DROP_KINDS, type DropResource, VIEWER_KINDS } from "../../../shared/types.ts"

export interface DropRuntimeError {
  kind: "error" | "rejection" | "console" | "load"
  message: string
  source?: string
  page?: string
  count: number
  lastAt: number
}

export const drops = sqliteTable(
  "drops",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind", { enum: DROP_KINDS }).notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    blobKey: text("blob_key"),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
    version: integer("version").notNull().default(1),
    slug: text("slug"),
    share: text("share", { enum: ["private", "team", "team_edit", "public", "public_comment"] })
      .notNull()
      .default("private"),
    publicUntil: integer("public_until"),
    teamFolder: integer("team_folder", { mode: "boolean" }).notNull().default(false),
    shareReview: text("share_review", { enum: ["pending", "rejected"] }),
    quarantinedAt: integer("quarantined_at"),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorName: text("actor_name").notNull(),
    agent: text("agent", { mode: "json" }).$type<AgentMetadata>(),
    sessionPublisherId: text("session_publisher_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastAccessedAt: integer("last_accessed_at"),
    lifetime: text("lifetime", { enum: ["temporary", "review", "keep"] })
      .notNull()
      .default("review"),
    keepReason: text("keep_reason"),
    note: text("note"),
    trashedAt: integer("trashed_at"),
    trashReason: text("trash_reason", { enum: ["deleted", "expired"] }),
    parentId: text("parent_id"),
    draftImage: integer("draft_image", { mode: "boolean" }).notNull().default(false),
    siteUrl: text("site_url"),
    publishToken: text("publish_token"),
    teamId: text("team_id"),
    resources: text("resources", { mode: "json" }).$type<DropResource[]>(),
  },
  (table) => [
    index("drops_owner_idx").on(table.ownerId, table.updatedAt),
    uniqueIndex("drops_blob_key_idx").on(table.blobKey),
    index("drops_expiry_idx").on(table.lifetime, table.lastAccessedAt),
    index("drops_trash_idx").on(table.trashedAt),
    index("drops_parent_idx").on(table.parentId),
    index("drops_share_idx").on(table.share, table.updatedAt),
  ],
)

export const dropVersions = sqliteTable(
  "drop_versions",
  {
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kind: text("kind", { enum: DROP_KINDS }).notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    blobKey: text("blob_key"),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
    note: text("note"),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorName: text("actor_name").notNull(),
    agent: text("agent", { mode: "json" }).$type<AgentMetadata>(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dropId, table.version] }),
    uniqueIndex("drop_versions_blob_key_idx").on(table.blobKey),
  ],
)

export const dropTexts = sqliteTable("drop_texts", {
  dropId: text("drop_id")
    .primaryKey()
    .references(() => drops.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
})

export const dropVisits = sqliteTable(
  "drop_visits",
  {
    userId: text("user_id").notNull(),
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    at: integer("at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.dropId] }), index("drop_visits_drop_idx").on(table.dropId)],
)

export const dropViews = sqliteTable(
  "drop_views",
  {
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    viewer: text("viewer", { enum: VIEWER_KINDS }).notNull(),
    views: integer("views").notNull(),
  },
  (table) => [primaryKey({ columns: [table.dropId, table.day, table.viewer] })],
)

export const dropViewers = sqliteTable(
  "drop_viewers",
  {
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    id: text("id").notNull(),
    viewer: text("viewer", { enum: VIEWER_KINDS }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dropId, table.day, table.id] }),
    index("drop_viewers_day_idx").on(table.day),
  ],
)

export const dropFiles = sqliteTable(
  "drop_files",
  {
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    blobKey: text("blob_key").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [uniqueIndex("drop_files_path_idx").on(table.dropId, table.path)],
)

export const commentAttachments = sqliteTable(
  "comment_attachments",
  {
    dropId: text("drop_id")
      .primaryKey()
      .references(() => drops.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    replyId: text("reply_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("comment_attachments_comment_idx").on(table.commentId, table.createdAt)],
)

export const blobCleanup = sqliteTable("blob_cleanup", {
  id: text("id").primaryKey(),
  blobKey: text("blob_key").notNull().unique(),
  createdAt: integer("created_at").notNull(),
})

export const commentCleanup = sqliteTable("comment_cleanup", {
  dropId: text("drop_id").primaryKey(),
  scope: text("scope").notNull(),
  shot: integer("shot", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
})

export const suggestionAcceptances = sqliteTable(
  "suggestion_acceptances",
  {
    threadId: text("thread_id").primaryKey(),
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    undoneVersion: integer("undone_version"),
  },
  (table) => [index("suggestion_acceptances_drop").on(table.dropId)],
)

export const dropRuntimeErrors = sqliteTable("drop_runtime_errors", {
  dropId: text("drop_id")
    .primaryKey()
    .references(() => drops.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  errors: text("errors", { mode: "json" }).$type<DropRuntimeError[]>().notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const codeImages = sqliteTable(
  "code_images",
  {
    blobKey: text("blob_key").primaryKey(),
    ownerId: text("owner_id").notNull(),
    size: integer("size").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("code_images_owner_idx").on(table.ownerId),
    index("code_images_expires_idx").on(table.expiresAt),
    check("code_images_size", sql`${table.size} >= 0`),
  ],
)
