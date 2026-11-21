import { daysUntil } from "#shared/expiry"
import { isPublic, type Share, SHARE_HINTS, SHARE_ICONS, SHARE_LABELS, SHARES, shareBlock } from "#shared/share"
import type { DropSummary, Viewer } from "#shared/types"

export function shareItems(viewer: Viewer | null | undefined, drop: Pick<DropSummary, "kind" | "teamFolder" | "team">) {
  const mode = drop.team ? "team" : (viewer?.mode ?? "personal")
  return SHARES.map((value) => {
    const blocked = shareBlock(value, mode, viewer?.publicLinkDays ?? null, drop, Boolean(viewer?.teams))
    return {
      value,
      label: SHARE_LABELS[value],
      icon: SHARE_ICONS[value],
      description: blocked ?? SHARE_HINTS[value],
      disabled: Boolean(blocked),
    }
  })
}

export function shareStatus(
  drop: Pick<DropSummary, "share" | "publicUntil" | "shareReview" | "quarantinedAt">,
  now = Date.now(),
) {
  if (drop.quarantinedAt) return "Quarantined"
  if (drop.shareReview === "pending") return "Pending review"
  if (drop.shareReview === "rejected") return "Share rejected"
  if (isPublic(drop.share) && drop.publicUntil)
    return `${SHARE_LABELS[drop.share]} · ${daysUntil(drop.publicUntil, now)}d left`
  return SHARE_LABELS[drop.share]
}

export const SHARED_TITLES: Record<Share, string> = {
  private: "Only you now",
  team: "Shared with the team",
  team_edit: "The team can edit it",
  public: "Public link on",
  public_comment: "Public link on, anyone comments",
}
