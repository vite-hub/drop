import type { AgentMetadata } from "../../shared/agent.ts"
import { sql } from "drizzle-orm"
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ACTOR_KINDS, DROP_KINDS, type DropResource, VIEWER_KINDS } from "../../shared/types.ts"

/**
 * A drop is one thing an agent (or a person) published for review: a doc (Markdown, HTML, an image, any
 * file) stored as one blob, an app stored as a folder of blobs in `drop_files`, a folder of other drops, or a site:
 * a live website people review in place, whose comments arrive with screenshots. The row is the drop as it is now, its
 * latest version included; `drop_versions` keeps the versions before it.
 */
export const drops = sqliteTable(
  "drops",
  {
    /** The share link's key (`/d/<id>/<slug>`), the same for every version, so the link opens the latest one. */
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind", { enum: DROP_KINDS }).notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    /** Blob key for docs (`<uuid>.<ext>`, served at `/f/<key>`). Null for apps. */
    blobKey: text("blob_key"),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
    /** The latest version's number. The ones before it are in `drop_versions`. */
    version: integer("version").notNull().default(1),
    /** The readable part of the link, picked by the agent or taken from the title. */
    slug: text("slug"),
    /** Who can open it and what they can do, as one state (#shared/share). */
    share: text("share", { enum: ["private", "team", "team_edit", "public", "public_comment"] })
      .notNull()
      .default("private"),
    /** When a public link closes; the drop falls back to Team (team Drops) or Only me. Null keeps it open. */
    publicUntil: integer("public_until"),
    /** Folders only: the team keeps it. Everyone adds drops to it; admins name, describe, and share it. */
    teamFolder: integer("team_folder", { mode: "boolean" }).notNull().default(false),
    /** Public links only: an admin approves them first when `DROP_SHARE_APPROVAL` is on. */
    shareReview: text("share_review", { enum: ["pending", "rejected"] }),
    quarantinedAt: integer("quarantined_at"),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorName: text("actor_name").notNull(),
    agent: text("agent", { mode: "json" }).$type<AgentMetadata>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** Last real visit by a person or an agent. Expiry counts from here, falling back to `createdAt`. */
    lastAccessedAt: integer("last_accessed_at"),
    /**
     * How long the drop should live, picked by whoever publishes it: `temporary` (prototypes, one-off answers),
     * `review` (docs going through feedback), or `keep` (PR assets, anything linked from somewhere lasting).
     */
    lifetime: text("lifetime", { enum: ["temporary", "review", "keep"] })
      .notNull()
      .default("review"),
    /** Why an agent kept the drop, shown to its owner. Null when a person chose `keep`. */
    keepReason: text("keep_reason"),
    /** What changed in the latest version, like a commit message. A folder's is its description. */
    note: text("note"),
    /** When the drop went to the Trash; it's purged 15 days later. */
    trashedAt: integer("trashed_at"),
    trashReason: text("trash_reason", { enum: ["deleted", "expired"] }),
    /** The doc an image belongs to. Attachments share the doc's sharing, lifetime, and Trash, and don't count as drops. */
    parentId: text("parent_id"),
    /** Sites only: the origin of the website under review, or a `*.` pattern of them; the only ones its review script may post from. */
    siteUrl: text("site_url"),
    /** CAS token used while replacing an app's file set. */
    publishToken: text("publish_token"),
    /** Team folders on a personal Drop: the team (organization) whose members it reaches. Null on a team Drop's own. */
    teamId: text("team_id"),
    /**
     * Links the drop points to, like its pull request and that PR's preview, shown with their sites' icons at the top
     * of its page. Agents set them (../utils/resources.ts). Null when it has none.
     */
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

/**
 * The versions of a doc before its latest, which is the `drops` row. Publishing a version copies the row's version
 * here and writes the new one over it. Sharing, lifetime, and the Trash belong to the drop, not to a version.
 */
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

/** The words of a text doc's latest version (Markdown, HTML as plain text), for search. Its own table so the many `select drops.*` reads don't carry it. */
export const dropTexts = sqliteTable("drop_texts", {
  dropId: text("drop_id")
    .primaryKey()
    .references(() => drops.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
})

/**
 * Public drops someone else owns that a signed-in person opened, for their "Shared with me" list. Team drops need no
 * row: everyone in the Drop sees those.
 */
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

/**
 * A drop's views a day, by who viewed it: signed-in people, anonymous visitors, or agents. Every version adds to one
 * count. A trigger on `drop_viewers` counts each viewer once a day.
 */
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

/**
 * Who viewed a drop today: a user id, an agent, or an anonymous visitor's hash under a key of the day and the drop
 * (./utils/views.ts). Inserting a new row counts a view; the hourly cleanup deletes earlier days.
 */
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

/** Files of an app drop. Publishing a new version replaces the set. */
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

/**
 * Images in a comment or in one of its replies. Each image is a drop of its own under the commented drop (see
 * server/utils/comment-images.ts), so it shares that drop's sharing, lifetime, and Trash; this row says whose it is.
 * The comments themselves are ViteHub Comments threads (server/utils/comments.ts): `commentId` is a thread's first
 * comment, and `replyId` the reply, when the image is a reply's.
 */
export const commentAttachments = sqliteTable(
  "comment_attachments",
  {
    dropId: text("drop_id")
      .primaryKey()
      .references(() => drops.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    /** Null when the image is on the thread's first comment. */
    replyId: text("reply_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("comment_attachments_comment_idx").on(table.commentId, table.createdAt)],
)

/** Blob deletions that need another attempt after metadata has been removed. */
export const blobCleanup = sqliteTable("blob_cleanup", {
  id: text("id").primaryKey(),
  blobKey: text("blob_key").notNull().unique(),
  createdAt: integer("created_at").notNull(),
})

/** Comment cleanup committed with Drop deletion, without a foreign key to the deleted row. */
export const commentCleanup = sqliteTable("comment_cleanup", {
  dropId: text("drop_id").primaryKey(),
  scope: text("scope").notNull(),
  shot: integer("shot", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
})

/** A receipt committed with the accepted edit, so a Comments outage never makes a retry publish it twice. */
export const suggestionAcceptances = sqliteTable(
  "suggestion_acceptances",
  {
    threadId: text("thread_id").primaryKey(),
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
  },
  (table) => [index("suggestion_acceptances_drop").on(table.dropId)],
)

/**
 * Temporary public images. They still belong to an account, follow its ban, and count toward its storage until the
 * hourly cleanup has deleted the blob and then the row.
 */
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
