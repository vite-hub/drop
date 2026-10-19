// The contract between Drop's API and its pages. Server routes return these shapes; pages render them.
import type { Lifetime } from "./expiry"
import type { Role } from "./roles"

export type DropKind = "markdown" | "html" | "image" | "file" | "app" | "folder" | "site"
/** `team`: everyone signed in to this Drop. `shared`: anyone with the link, signed in or not. */
export type Visibility = "private" | "team" | "shared"
export type Access = "view" | "comment" | "edit"
export type ActorKind = "agent" | "browser"

export const ACCESS_RANK: Record<Access, number> = { view: 0, comment: 1, edit: 2 }
export const ACCESS_LABELS: Record<Access, string> = { view: "Can view", comment: "Can comment", edit: "Can edit" }
export const ACCESS_HINTS: Record<Access, string> = { view: "Read only.", comment: "View and leave comments.", edit: "Comment, and edit Markdown together after signing in." }

/** One name per level, the same on rows, buttons, menus, and the share dialog. */
export const VISIBILITY_LABELS: Record<Visibility, string> = { private: "Private", team: "Team", shared: "Public link" }
export const VISIBILITY_HINTS: Record<Visibility, string> = { private: "Only you. Your connected agents can still read it.", team: "Everyone signed in to this Drop can find and open it.", shared: "Anyone with the link can open it, no sign-in needed." }
export const VISIBILITY_ICONS: Record<Visibility, string> = { private: "i-ph-lock", team: "i-ph-users", shared: "i-ph-globe" }

export interface DropSummary {
  /** This version. */
  id: string
  /** The doc's share link key, the same on every version (`/d/<link>/<slug>`, see #shared/links). */
  link: string
  /** The readable part of the link. */
  slug: string
  kind: DropKind
  title: string
  filename: string
  size: number
  version: number
  shareReview: "pending" | "rejected" | null
  quarantinedAt: number | null
  visibility: Visibility
  access: Access
  actorKind: ActorKind
  actorName: string
  createdAt: number
  updatedAt: number
  /** Apps only. */
  paths?: string[]
  /** When the drop stops being served unless someone visits it. Null when it never expires. */
  expiresAt: number | null
  lifetime: Lifetime
  /** Why an agent kept this drop. Null when a person chose to keep it. */
  keepReason: string | null
  /** What changed in this version. */
  note: string | null
  /** When it went to the Trash (or expired into it). Null while it's live. */
  trashedAt: number | null
  trashReason: "deleted" | "expired" | null
  /**
   * The node this drop sits in: a folder, or the doc an embedded file belongs to. A drop takes the widest share on its
   * path, and the lifetime and Trash of the top-most node (see server/utils/nodes.ts).
   */
  parentId: string | null
  /** The node above whose share reaches wider than this drop's own. `visibility` and `access` then say the widest. */
  sharedFrom?: { id: string; title: string }
  /** This drop's own share, when a node above shares it wider. The share controls change this one. */
  ownShare?: { visibility: Visibility; access: Access }
  /** Folders: how many drops are directly inside. */
  items?: number
  /** Images in a folder or a search: where the file is served, for a thumbnail. */
  thumbnail?: string
  /** Search results: the folders it sits in, top-most first. */
  path?: DropCrumb[]
  /** Search results: words around the match in a doc's text, when its name doesn't have them all. */
  snippet?: string
  /** "Shared with me" and search: whose drop it is, when it isn't yours. */
  owner?: { name: string; image: string | null }
}

/** A node on the way to a drop, for breadcrumbs. */
export interface DropCrumb { id: string; kind: DropKind; title: string; link: string; slug: string }

export interface DropVersion { id: string; title: string; version: number; createdAt: number; note: string | null; actorName: string; current?: boolean }

/** A file a doc embeds from this Drop (an image, usually). It belongs to the doc. */
export interface DropAttachment { id: string; kind: DropKind; title: string; filename: string; size: number; url: string }

export interface DropDetail extends DropSummary {
  isOwner: boolean
  canComment: boolean
  /** Live editing: a Markdown drop's current version, for people who may edit it, on a host with Realtime. */
  canEdit: boolean
  /** Why someone who may edit can't open this doc in the live editor. */
  editNote?: string
  /** Text source for Markdown and HTML docs. */
  content?: string
  /** Markdown docs, rendered by the server's Comark renderer: the viewer shows exactly what /f/ shows. */
  html?: string
  /** Where the raw file is served, for images and other files. */
  url?: string
  /** App files keyed by path. */
  files?: Record<string, string>
  /** Apps and HTML docs: the separate origin the viewer frames them on. Absent means an opaque-origin sandbox. */
  contentOrigin?: string
  versions: DropVersion[]
  /** Docs: the files they embed from this Drop. */
  attachments?: DropAttachment[]
  /** The nodes above this one that the reader may open, top-most first. */
  ancestors: DropCrumb[]
  /** Folders: the drops directly inside, newest first. */
  children?: DropSummary[]
  /** Sites: the origin of the website under review. */
  siteUrl?: string
}

export interface DropComment {
  id: string
  n: number
  /** `text` quotes a selection, `image` marks a spot or area of an image, `area` a rectangle of a page. */
  kind: "text" | "image" | "area"
  selector: string
  /** Position and size in thousandths of the anchor's box. A point has `ow` = `oh` = 0. */
  ox: number
  oy: number
  ow: number
  oh: number
  quote: string | null
  label: string | null
  page: string | null
  body: string
  authorName: string
  /** The author's picture, when they have one; pins and threads fall back to initials. */
  authorImage: string | null
  resolved: boolean
  createdAt: number
  /** The version it was written on. Open comments carry over to later versions until someone resolves them. */
  version: number
  mine: boolean
  /** The thread under it, oldest first. */
  replies: CommentReply[]
}

/** A reply in a comment's thread: words only, the comment keeps the anchor and the resolved state. */
export interface CommentReply {
  id: string
  body: string
  authorName: string
  authorImage: string | null
  createdAt: number
  mine: boolean
}

/**
 * A comment someone sent from a site under review, with the screenshot it came with. Its box is in thousandths of
 * the screenshot (the viewport they saw); `page` is the address they were on.
 */
export interface SiteReviewItem extends DropComment {
  /** The screenshot's own drop, which shows the box and takes replies. Null when the page couldn't take one. */
  screenshot: { id: string; link: string; slug: string; url: string } | null
}

export interface Member {
  id: string
  name: string
  /** Only admins see other people's emails; GitHub may have handed over one its owner keeps private. */
  email: string | null
  image: string | null
  role: Role
  banned: boolean
  drops: number
  /** Null until they first sign in. */
  lastActiveAt: number | null
  you: boolean
}

/** An MCP client someone approved on /oauth: it acts as them until disconnected. */
/** A built-in Agent Skill as the catalog shows it. Members only see enabled ones; admins see all. */
export interface SkillSummary {
  name: string
  description: string
  enabled: boolean
  /** The full skill on GitHub. */
  source: string
}

export interface ConnectedAgent {
  id: string
  name: string
  connectedAt: number | null
}

export interface Viewer {
  id: string
  name: string
  email: string
  image: string | null
  role: Role
  /** This Drop's expiry rules: days a drop lives after its last visit (0 is off), and whether owners may opt out. */
  expiry: { days: number; custom: boolean }
  /** Personal until a second person joins. */
  team: boolean
  members: number
}
