import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/**
 * A drop is one thing an agent (or a person) published for review: a doc (Markdown, HTML, an image, any
 * file) stored as one blob, or an app stored as a folder of blobs in `drop_files`.
 * Legacy anonymous uploads have no row and stay public.
 */
export const drops = sqliteTable("drops", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind", { enum: ["markdown", "html", "image", "file", "app"] }).notNull(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  /** Blob key for docs (`<uuid>.<ext>`, served at `/f/<key>`). Null for apps. */
  blobKey: text("blob_key"),
  contentType: text("content_type"),
  size: integer("size").notNull().default(0),
  version: integer("version").notNull().default(1),
  supersedesId: text("supersedes_id"),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("private"),
  shareReview: text("share_review", { enum: ["pending", "rejected"] }),
  quarantinedAt: integer("quarantined_at"),
  access: text("access", { enum: ["view", "comment", "edit"] }).notNull().default("comment"),
  actorKind: text("actor_kind", { enum: ["agent", "browser"] }).notNull(),
  actorName: text("actor_name").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** CAS token used while replacing an app's file set. */
  publishToken: text("publish_token"),
}, table => [
  index("drops_owner_idx").on(table.ownerId, table.updatedAt),
  uniqueIndex("drops_blob_key_idx").on(table.blobKey),
  index("drops_supersedes_idx").on(table.supersedesId),
  uniqueIndex("drops_supersedes_unique").on(table.supersedesId),
])

/** Files of an app drop. Publishing a new version replaces the set. */
export const dropFiles = sqliteTable("drop_files", {
  dropId: text("drop_id").notNull().references(() => drops.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  blobKey: text("blob_key").notNull(),
  size: integer("size").notNull(),
}, table => [uniqueIndex("drop_files_path_idx").on(table.dropId, table.path)])

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  dropId: text("drop_id").notNull().references(() => drops.id, { onDelete: "cascade" }),
  n: integer("n").notNull(),
  kind: text("kind", { enum: ["text", "image"] }).notNull(),
  selector: text("selector").notNull(),
  ox: integer("ox").notNull().default(0),
  oy: integer("oy").notNull().default(0),
  quote: text("quote"),
  label: text("label"),
  page: text("page"),
  body: text("body").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name").notNull(),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, table => [index("comments_drop_idx").on(table.dropId, table.n), uniqueIndex("comments_drop_n_unique").on(table.dropId, table.n)])

/** Blob deletions that need another attempt after metadata has been removed. */
export const blobCleanup = sqliteTable("blob_cleanup", {
  id: text("id").primaryKey(),
  blobKey: text("blob_key").notNull().unique(),
  createdAt: integer("created_at").notNull(),
})
