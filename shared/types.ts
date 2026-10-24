// The contract between Drop's API and its pages. Server routes return these shapes; pages render them.
import type { Lifetime } from "./expiry"
import type { Plan } from "./quotas"
import type { Role } from "./roles"
import type { DropMode, Share } from "./share"

export const DROP_KINDS = ["markdown", "html", "image", "file", "app", "folder", "site", "board"] as const
export type DropKind = (typeof DROP_KINDS)[number]
export const ACTOR_KINDS = ["agent", "browser"] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]
/** Who viewed a drop, for its Details: a signed-in person, an anonymous visitor, or an agent. */
export const VIEWER_KINDS = ["person", "anonymous", "agent"] as const
export type ViewerKind = (typeof VIEWER_KINDS)[number]

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
  /** Who can open it now (see #shared/share): the widest share on its path, with a closed public link resolved. */
  share: Share
  /** When its own public link closes. Null while it isn't public, or when public links stay open. */
  publicUntil: number | null
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
  /** What changed in this version. A folder's is its description: what goes in it, which agents read to pick it. */
  note: string | null
  /** When it went to the Trash (or expired into it). Null while it's live. */
  trashedAt: number | null
  trashReason: "deleted" | "expired" | null
  /**
   * The node this drop sits in: a folder, or the doc an embedded file belongs to. A drop takes the widest share on its
   * path, and the lifetime and Trash of the top-most node (see server/utils/nodes.ts).
   */
  parentId: string | null
  /** The node above whose share reaches wider than this drop's own. `share` then says the widest. */
  sharedFrom?: { id: string; title: string }
  /** This drop's own share, when a node above shares it wider. The share controls change this one. */
  ownShare?: Share
  /** Folders the team keeps: everyone adds to them; admins name, describe, and share them. */
  teamFolder?: boolean
  /** On a personal Drop with teams: the team whose folders hold it, which its team shares reach. */
  team?: string
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
export interface DropCrumb {
  id: string
  kind: DropKind
  title: string
  link: string
  slug: string
}

export interface DropVersion {
  id: string
  title: string
  version: number
  createdAt: number
  note: string | null
  actorName: string
  current?: boolean
}

/** A link a drop points to, like its pull request. Every version of the drop shows the same ones (#shared/resources). */
export interface DropResource {
  url: string
  /** What it is, like "PR #123". Without one, the page shows the link's host. */
  title?: string
}

/** A file a doc embeds from this Drop (an image, usually). It belongs to the doc. */
export interface DropAttachment {
  id: string
  kind: DropKind
  title: string
  filename: string
  size: number
  url: string
}

export interface DropDetail extends DropSummary {
  /** Change its share, name, lifetime, or folder: its owner and admins; a team folder's admins only. */
  isOwner: boolean
  /** Move it to the Trash: who may change it, and anyone on the team for a drop in a team folder. */
  canTrash: boolean
  canComment: boolean
  /** Live editing: a Markdown drop's current version, for people who may edit it, on a host with Realtime. */
  canEdit: boolean
  /** Why someone who may edit can't open this doc in the live editor. */
  editNote?: string
  /** Text source for Markdown and HTML docs. */
  content?: string
  /** A line of what it says, for link previews: a doc's first words, a folder's description, a site's address. */
  excerpt?: string
  /** Markdown docs, rendered by the server's Comark renderer: the viewer shows exactly what /f/ shows. */
  html?: string
  /** Where the raw file is served, for images and other files. */
  url?: string
  /** An app's text files keyed by path: all of them, or only its pages when its origin serves the rest (contentGrant). */
  files?: Record<string, string>
  /** Apps: each file's size in bytes, keyed by path. */
  sizes?: Record<string, number>
  /** Apps and HTML docs: the separate origin the viewer frames them on. Absent means an opaque-origin sandbox. */
  contentOrigin?: string
  /** Apps on a per-drop origin: what the viewer hands the frame so that origin serves the app's files to it. */
  contentGrant?: string
  versions: DropVersion[]
  /** Docs: the files they embed from this Drop. */
  attachments?: DropAttachment[]
  /** The nodes above this one that the reader may open, top-most first. */
  ancestors: DropCrumb[]
  /** Folders: the drops directly inside, newest first. */
  children?: DropSummary[]
  /** Sites: the origin of the website under review. */
  siteUrl?: string
  /** Its owner and admins: views of every version, each viewer counted once a day. Their own visits don't count. */
  views?: Record<ViewerKind, number>
  /** Links it points to, like its pull request and that PR's preview, in the order they were added. */
  resources?: DropResource[]
}

export interface DropComment {
  id: string
  n: number
  /** `text` quotes a selection, `image` marks a spot or area of an image, `area` a rectangle of a page, `page` the whole page. */
  kind: "text" | "image" | "area" | "page"
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
  /** Images sent with it. */
  attachments: CommentAttachment[]
}

/** A reply in a comment's thread: words and images; the comment keeps the anchor and the resolved state. */
export interface CommentReply {
  id: string
  body: string
  authorName: string
  authorImage: string | null
  createdAt: number
  mine: boolean
  attachments: CommentAttachment[]
}

/** An image someone sent with a comment or a reply. It's a drop of its own under the commented drop. */
export interface CommentAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  /** Where Drop serves it, relative to Drop's origin (`/f/<key>`), for whoever may view the drop. */
  url: string
}

/**
 * A comment someone sent from a site under review, with the screenshot it came with. Its box is in thousandths of
 * the screenshot (the viewport they saw); `page` is the address they were on.
 */
export interface SiteReviewItem extends DropComment {
  /** The screenshot's own drop, which shows the box and takes replies. Null when the page couldn't take one. */
  screenshot: { id: string; link: string; slug: string; url: string } | null
  /** Where the pin sits on the element `label` names, in thousandths of its box. Null without an element. */
  spot: { x: number; y: number } | null
}

/**
 * A thread as the review script shows it on the site's page: what Drop's own lists show, minus anything that would
 * open the review in Drop (ids, links). Images come from /api/review/images/<id> with the review token.
 */
export interface ReviewThread {
  n: number
  body: string
  author: { name: string; image: string | null }
  createdAt: number
  resolved: boolean
  mine: boolean
  /** Its author and the site's managers may resolve it, as in Drop. */
  canResolve: boolean
  page: string | null
  /** The element under the box: its CSS path and its name, as the page sent them. */
  element: { selector: string; label: string | null } | null
  spot: { x: number; y: number } | null
  /** The box, in thousandths of the viewport it was drawn in. */
  box: { ox: number; oy: number; ow: number; oh: number }
  screenshot: string | null
  images: { id: string; filename: string }[]
  replies: {
    author: { name: string; image: string | null }
    body: string
    createdAt: number
    images: { id: string; filename: string }[]
  }[]
}

export interface Member {
  id: string
  name: string
  /** Only admins see other people's emails; GitHub may have handed over one its owner keeps private. */
  email: string | null
  image: string | null
  role: Role
  /** Their limits: the tier an admin gave them, else this Drop's default plan. Null when quotas are off. */
  plan: Plan | null
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
  /** `DROP_MODE`: a personal Drop shares by public link; on a team Drop drops start shared with the team. */
  mode: DropMode
  /** Days a public link stays open before it closes (null: until changed, 0: public links are off). */
  publicLinkDays: number | null
  members: number
  /** How many skills are on: agents get them over MCP, and members see Skills only while one is. */
  skills: number
  /** Admins only: public shares waiting for their review (/admin/review). */
  reviews?: number
  /** On a personal Drop with `DROP_TEAMS`: the teams they're on. Absent when teams are off. */
  teams?: ViewerTeam[]
  /** Teams pay through Stripe here (`STRIPE_*`): past `freeMembers`, a team needs a subscription. */
  billing?: { freeMembers: number; annual: boolean }
  /** They're on a team that pays: the Pro plan. */
  paid?: boolean
}

interface ViewerTeam {
  id: string
  name: string
  slug: string
  role: "owner" | "admin" | "member"
  paid: boolean
}
