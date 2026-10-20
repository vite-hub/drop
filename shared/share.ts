// Who can open a drop and what they can do with it, as one state. A Drop runs in one of two modes: `personal`, where
// drops are private or public, and `team`, where everyone signed in is a teammate and drops are shared with them unless
// someone keeps one to themselves. Every rule about sharing resolves through here, on the server and in the pages.
import type { DropKind } from "./types"

/**
 * `private`: the owner (and admins). `team`: everyone signed in to this Drop, people and their agents, who view and
 * comment. `team_edit`: the team also edits Markdown together in the browser. `public`: anyone with the link views it,
 * signed-in people comment. `public_comment`: anyone with the link comments too, guests included. A public link closes
 * after `DROP_PUBLIC_LINK_DAYS` when that's set (on a team Drop, 7 by default); the drop then falls back (`liveShare`).
 */
export type Share = "private" | "team" | "team_edit" | "public" | "public_comment"
export type DropMode = "personal" | "team"

export const SHARES: Share[] = ["private", "team", "team_edit", "public", "public_comment"]

/** One name per state, the same on rows, buttons, menus, and the share dialog. */
export const SHARE_LABELS: Record<Share, string> = {
  private: "Only me",
  team: "Team",
  team_edit: "Team can edit",
  public: "Public link",
  public_comment: "Public, anyone comments",
}
export const SHARE_HINTS: Record<Share, string> = {
  private: "Only you. Your connected agents can still read it.",
  team: "Everyone on the team can find it, open it, and comment.",
  team_edit: "Everyone on the team can comment and edit it together.",
  public: "Anyone with the link can open it, no sign-in needed. People signed in can comment.",
  public_comment: "Anyone with the link can open it and comment, guests included.",
}
export const SHARE_ICONS: Record<Share, string> = {
  private: "i-mingcute-lock-line",
  team: "i-mingcute-group-line",
  team_edit: "i-mingcute-group-3-line",
  public: "i-mingcute-world-2-line",
  public_comment: "i-mingcute-world-2-line",
}

/** On a folder path the widest share shows; `grants` still keep each one for what it lets the caller do. */
export const SHARE_RANK: Record<Share, number> = { private: 0, team: 1, team_edit: 2, public: 3, public_comment: 4 }

/** The states anyone with the link opens, signed in or not: public links, which close and go through share review. */
export const isPublic = (share: Share) => share === "public" || share === "public_comment"

/** What a share lets someone do: -1 nothing, 0 view, 1 comment, 2 edit (people in the browser only). */
export function shareLevel(share: Share, signedIn: boolean): -1 | 0 | 1 | 2 {
  if (share === "public_comment") return 1
  if (share === "public") return signedIn ? 1 : 0
  if (!signedIn || share === "private") return -1
  return share === "team_edit" ? 2 : 1
}

/**
 * The share in force now. A public link past its date falls back to Team on a team Drop and to Only me on a personal
 * one; a team share left from when the Drop ran as a team reaches nobody on a personal Drop.
 */
export function liveShare(share: Share, publicUntil: number | null, mode: DropMode, now = Date.now()): Share {
  if (isPublic(share) && publicUntil !== null && publicUntil <= now) return mode === "team" ? "team" : "private"
  if (mode === "personal" && (share === "team" || share === "team_edit")) return "private"
  return share
}

/** The share a new drop starts with: the team's on a team Drop, private on a personal one. */
export const defaultShare = (mode: DropMode): Share => (mode === "team" ? "team" : "private")

/**
 * The states someone may pick for a drop. Team states need a team Drop; editing together needs Markdown (or a folder,
 * for the Markdown in it); a team folder always reaches the team; `publicLinkDays` 0 turns public links off.
 */
export function sharesFor(
  mode: DropMode,
  publicLinkDays: number | null,
  drop: { kind: DropKind; teamFolder?: boolean },
): Share[] {
  return SHARES.filter((share) => {
    if (share === "private") return !drop.teamFolder
    if (isPublic(share)) return publicLinkDays !== 0
    if (mode !== "team") return false
    return share === "team" || drop.kind === "markdown" || drop.kind === "folder"
  })
}

/** When a link made public now closes. Null keeps it open until someone changes it. */
export const publicUntilFrom = (publicLinkDays: number | null, now = Date.now()) =>
  publicLinkDays ? now + publicLinkDays * 86_400_000 : null
