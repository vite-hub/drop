import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/**
 * A drop is one thing an agent (or a person) published for review: a doc (Markdown, HTML, an image, any
 * file) stored as one blob, or an app stored as a folder of blobs in `drop_files`.
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
  /** Last real visit by a person or an agent. Expiry counts from here, falling back to `createdAt`. */
  lastAccessedAt: integer("last_accessed_at"),
  /**
   * How long the drop should live, picked by whoever publishes it: `temporary` (prototypes, one-off answers),
   * `review` (docs going through feedback), or `keep` (PR assets, anything linked from somewhere lasting).
   */
  lifetime: text("lifetime", { enum: ["temporary", "review", "keep"] }).notNull().default("review"),
  /** Why an agent kept the drop, shown to its owner. Null when a person chose `keep`. */
  keepReason: text("keep_reason"),
  /** What changed in this version, like a commit message. Agents write one for every version they publish. */
  note: text("note"),
  /** When the drop went to the Trash; it's purged 15 days later. Set on every version of the chain. */
  trashedAt: integer("trashed_at"),
  trashReason: text("trash_reason", { enum: ["deleted", "expired"] }),
  /** The doc an image belongs to. Attachments share the doc's sharing, lifetime, and Trash, and don't count as drops. */
  parentId: text("parent_id"),
  /** CAS token used while replacing an app's file set. */
  publishToken: text("publish_token"),
}, table => [
  index("drops_owner_idx").on(table.ownerId, table.updatedAt),
  uniqueIndex("drops_blob_key_idx").on(table.blobKey),
  index("drops_supersedes_idx").on(table.supersedesId),
  uniqueIndex("drops_supersedes_unique").on(table.supersedesId),
  index("drops_expiry_idx").on(table.lifetime, table.lastAccessedAt),
  index("drops_trash_idx").on(table.trashedAt),
  index("drops_parent_idx").on(table.parentId),
])

/** Current versions, maintained by drop insert/delete/update triggers for bounded listing reads. */
export const dropHeads = sqliteTable("drop_heads", {
  dropId: text("drop_id").primaryKey().references(() => drops.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("drop_heads_owner_idx").on(table.ownerId, table.updatedAt)])

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
  /** `text` quotes a selection, `image` pins a spot or area on an image, `area` marks a rectangle of an HTML page. */
  kind: text("kind", { enum: ["text", "image", "area"] }).notNull(),
  selector: text("selector").notNull(),
  ox: integer("ox").notNull().default(0),
  oy: integer("oy").notNull().default(0),
  /** An area's size, in thousandths of the anchor's box like `ox`/`oy`. Zero for a point. */
  ow: integer("ow").notNull().default(0),
  oh: integer("oh").notNull().default(0),
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

/** Temporary public images still belong to an account and follow its ban. */
export const codeImages = sqliteTable("code_images", {
  blobKey: text("blob_key").primaryKey(),
  ownerId: text("owner_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("code_images_expires_idx").on(table.expiresAt)])

/** Maintained by user insert/delete triggers, so /api/me never counts the whole user table. */
export const workspaceStats = sqliteTable("workspace_stats", {
  id: integer("id").primaryKey(),
  members: integer("members").notNull(),
}, table => [check("workspace_stats_singleton", sql`${table.id} = 1`)])
