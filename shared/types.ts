import type { CommentDelivery } from "vite-hub/comments/client"
import type { AgentMetadata } from "./agent"
import type { Lifetime } from "./expiry"
import type { Role } from "./roles"
import type { Ink } from "./schemas"
import type { DropMode, Share } from "./share"

export const DROP_KINDS = ["markdown", "html", "image", "file", "app", "folder", "site", "board", "link"] as const
export type DropKind = (typeof DROP_KINDS)[number]
export const ACTOR_KINDS = ["agent", "browser"] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]
export const VIEWER_KINDS = ["person", "anonymous", "agent"] as const
export type ViewerKind = (typeof VIEWER_KINDS)[number]

export const TREE_ROWS = 30

export interface DropTree {
  drops: DropSummary[]
  total: number
}

export interface DropSummary {
  id: string
  link: string
  slug: string
  kind: DropKind
  title: string
  filename: string
  size: number
  version: number
  shareReview: "pending" | "rejected" | null
  quarantinedAt: number | null
  share: Share
  publicUntil: number | null
  actorKind: ActorKind
  actorName: string
  createdAt: number
  updatedAt: number
  paths?: string[]
  expiresAt: number | null
  lifetime: Lifetime
  keepReason: string | null
  note: string | null
  trashedAt: number | null
  trashReason: "deleted" | "expired" | null
  parentId: string | null
  sharedFrom?: { id: string; title: string }
  ownShare?: Share
  teamFolder?: boolean
  team?: string
  items?: number
  href?: string
  thumbnail?: string
  path?: DropCrumb[]
  snippet?: string
  owner?: { name: string; image: string | null }
  pinned?: boolean
}

export interface DropPeek {
  id: string
  kind: DropKind
  title: string
  thumbnail?: string
  text?: string
  inside?: DropPeek[]
}

export type DropPeeks = Record<string, DropPeek>

export type DropGalleryItem = DropCrumb & { thumbnail: string }

export interface DropCrumb {
  id: string
  kind: DropKind
  title: string
  link: string
  slug: string
}

export interface DropVersion {
  title: string
  version: number
  createdAt: number
  note: string | null
  actorName: string
  agent: AgentMetadata | null
  current?: boolean
}

export interface DropResource {
  url: string
  title?: string
}

export interface RelatedDrop {
  id: string
  title: string
  kind: DropKind
  links: DropResource[]
}

export interface DropAttachment {
  id: string
  kind: DropKind
  title: string
  filename: string
  size: number
  url: string
}

export interface DropRuntimeError {
  kind: "error" | "rejection" | "console" | "load"
  message: string
  source?: string
  page?: string
  count: number
  lastAt: number
}

export interface PrivateEmbed {
  doc: { id: string; title: string }
  link: string
  title: string | null
}

export interface UncheckedEmbeds {
  docs: number
  embeds: number
}

export interface DropDetail extends DropSummary {
  siteScreenshot?: boolean
  lifetimeFixed?: boolean
  isOwner: boolean
  canTrash: boolean
  canComment: boolean
  canEdit: boolean
  editNote?: string
  content?: string
  excerpt?: string
  html?: string
  url?: string
  files?: Record<string, string>
  sizes?: Record<string, number>
  contentOrigin?: string
  contentGrant?: string
  versions: DropVersion[]
  attachments?: DropAttachment[]
  ancestors: DropCrumb[]
  children?: DropSummary[]
  gallery?: DropGalleryItem[]
  siteUrl?: string
  views?: Record<ViewerKind, number>
  resources?: DropResource[]
  quiz?: DropQuiz
  install?: SkillInstall
  errors?: DropRuntimeError[]
}

export interface SkillInstall {
  link: string
  slug: string
  skills?: number
  skill?: string
}

export interface QuizAnswer {
  choice: string[]
  correct: boolean | null
}

export interface QuizResult {
  counts: Record<string, number>
  total: number
}

export interface DropQuiz {
  answers: Record<string, QuizAnswer>
  results: Record<string, QuizResult>
}

export interface QuizSaved {
  answer: QuizAnswer
  results?: QuizResult
}

export interface DropComment {
  id: string
  messageId: string
  n: number
  kind: "text" | "image" | "area" | "page"
  selector: string
  ox: number
  oy: number
  ow: number
  oh: number
  quote: string | null
  suggestion: string | null
  at: number | null
  pdfPage: number | null
  ink: Ink | null
  label: string | null
  page: string | null
  body: string
  authorId: string
  authorName: string
  authorImage: string | null
  agent: CommentAgent | null
  mentions: string[]
  resolved: boolean
  resolvedAt: number | null
  createdAt: number
  editedAt: number | null
  version: number
  mine: boolean
  replies: CommentReply[]
  attachments: CommentAttachment[]
  people: { id: string; name: string; image: string | null }[]
  requestId?: string
  delivery?: CommentDelivery
}

export interface CommentReply {
  id: string
  body: string
  authorId: string
  authorName: string
  authorImage: string | null
  agent: CommentAgent | null
  mentions: string[]
  createdAt: number
  editedAt: number | null
  mine: boolean
  attachments: CommentAttachment[]
  requestId?: string
  delivery?: CommentDelivery
}

export interface CommentAgent {
  name: string
  image: string | null
}

export interface CommentAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  url: string
}

export interface SiteReviewItem extends DropComment {
  requestId?: string
  screenshot: { id: string; link: string; slug: string; url: string } | null
  spot: { x: number; y: number } | null
}

export interface ReviewThread {
  n: number
  requestId?: string
  body: string
  author: { name: string; image: string | null }
  createdAt: number
  resolved: boolean
  mine: boolean
  canResolve: boolean
  page: string | null
  element: { selector: string; label: string | null } | null
  spot: { x: number; y: number } | null
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

export interface SkillSummary {
  name: string
  description: string
  enabled: boolean
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
  expiry: { days: number; custom: boolean }
  mode: DropMode
  publicLinkDays: number | null
  skills: number
  teams?: ViewerTeam[]
  billing?: { freeMembers: number; annual: boolean }
  paid?: boolean
}

interface ViewerTeam {
  id: string
  name: string
  slug: string
  role: "owner" | "admin" | "member"
  paid: boolean
  pastDue: boolean
}
