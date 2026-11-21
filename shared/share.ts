import type { DropKind } from "./types"

export type Share = "private" | "team" | "team_edit" | "public" | "public_comment"
export type DropMode = "personal" | "team"

export const SHARES: Share[] = ["private", "team", "team_edit", "public", "public_comment"]

export const SHARE_LABELS: Record<Share, string> = {
  private: "Only me",
  team: "Team",
  team_edit: "Team can edit",
  public: "Public link",
  public_comment: "Public, anyone comments",
}
export const SHARE_HINTS: Record<Share, string> = {
  private: "Only you. Your agents can still read it.",
  team: "The team finds it, opens it, and comments.",
  team_edit: "The team also edits it with you.",
  public: "Anyone with the link opens it. Sign in to comment.",
  public_comment: "Anyone with the link opens it and comments, no sign-in.",
}
export const SHARE_ICONS: Record<Share, string> = {
  private: "i-mingcute-lock-line",
  team: "i-mingcute-group-2-line",
  team_edit: "i-mingcute-group-3-line",
  public: "i-mingcute-world-2-line",
  public_comment: "i-mingcute-world-2-line",
}

export const SHARE_RANK: Record<Share, number> = { private: 0, team: 1, team_edit: 2, public: 3, public_comment: 4 }

export const isPublic = (share: Share) => share === "public" || share === "public_comment"

export function shareLevel(share: Share, signedIn: boolean): -1 | 0 | 1 | 2 {
  if (share === "public_comment") return 1
  if (share === "public") return signedIn ? 1 : 0
  if (!signedIn || share === "private") return -1
  return share === "team_edit" ? 2 : 1
}

export function liveShare(share: Share, publicUntil: number | null, mode: DropMode, now = Date.now()): Share {
  if (isPublic(share) && publicUntil !== null && publicUntil <= now) return mode === "team" ? "team" : "private"
  if (mode === "personal" && (share === "team" || share === "team_edit")) return "private"
  return share
}

export const defaultShare = (mode: DropMode): Share => (mode === "team" ? "team" : "private")

export function shareBlock(
  share: Share,
  mode: DropMode,
  publicLinkDays: number | null,
  drop: { kind: DropKind; teamFolder?: boolean },
  teams = false,
): string | null {
  if (share === "private") return drop.teamFolder ? "A team folder always reaches the team." : null
  if (isPublic(share)) return publicLinkDays === 0 ? "Public links are off on this Drop." : null
  if (mode !== "team")
    return teams ? "Only drops in a team's folders share with a team." : "This Drop is personal, so it has no team."
  if (share === "team_edit" && drop.kind !== "markdown" && drop.kind !== "folder")
    return "Only Markdown docs and folders can be edited together."
  return null
}

export const publicUntilFrom = (publicLinkDays: number | null, now = Date.now()) =>
  publicLinkDays ? now + publicLinkDays * 86_400_000 : null
