// The contract between Drop's API and its pages. Server routes return these shapes; pages render them.
import type { Role } from "./roles"

export type DropKind = "markdown" | "html" | "image" | "file" | "app"
export type Visibility = "private" | "shared"
export type Access = "view" | "comment" | "edit"
export type ActorKind = "agent" | "browser"

export const ACCESS_RANK: Record<Access, number> = { view: 0, comment: 1, edit: 2 }
export const ACCESS_LABELS: Record<Access, string> = { view: "Can view", comment: "Can comment", edit: "Can edit" }
export const ACCESS_HINTS: Record<Access, string> = { view: "Read only.", comment: "View and leave comments.", edit: "View, comment, and publish new versions." }

export interface DropSummary {
  id: string
  kind: DropKind
  title: string
  filename: string
  size: number
  version: number
  visibility: Visibility
  access: Access
  actorKind: ActorKind
  actorName: string
  createdAt: number
  updatedAt: number
  /** Apps only. */
  paths?: string[]
}

export interface DropVersion { id: string; title: string; version: number; createdAt: number; current?: boolean }

export interface DropDetail extends DropSummary {
  isOwner: boolean
  canComment: boolean
  canEdit: boolean
  /** Text source for Markdown and HTML docs. */
  content?: string
  /** Markdown docs, rendered by the server's Comark renderer: the viewer shows exactly what /f/ shows. */
  html?: string
  /** Where the raw file is served, for images and other files. */
  url?: string
  /** App files keyed by path. */
  files?: Record<string, string>
  versions: DropVersion[]
}

export interface DropComment {
  id: string
  n: number
  kind: "text" | "image"
  selector: string
  ox: number
  oy: number
  quote: string | null
  label: string | null
  page: string | null
  body: string
  authorName: string
  resolved: boolean
  createdAt: number
  mine: boolean
}

export interface NewComment {
  kind: "text" | "image"
  selector: string
  ox: number
  oy: number
  quote?: string
  label?: string
  page?: string
  body: string
}

export interface Member {
  id: string
  name: string
  email: string
  image: string | null
  role: Role
  banned: boolean
  drops: number
  /** Null until they first sign in. */
  lastActiveAt: number | null
  you: boolean
}

/** An MCP client someone approved on /oauth: it acts as them until disconnected. */
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
  /** Personal until a second person joins. */
  team: boolean
  members: number
}
