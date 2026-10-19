import { daysUntil } from "#shared/expiry"
import { isPublic, type Share, SHARE_HINTS, SHARE_ICONS, SHARE_LABELS, sharesFor } from "#shared/share"
import type { DropSummary, Viewer } from "#shared/types"

/** The share states this Drop offers for a drop, as picker items: label, icon, and what each one lets people do. */
export function shareItems(viewer: Viewer | null | undefined, drop: Pick<DropSummary, "kind" | "teamFolder">) {
  return sharesFor(viewer?.mode ?? "personal", viewer?.publicLinkDays ?? null, drop)
    .map(value => ({ value, label: SHARE_LABELS[value], icon: SHARE_ICONS[value], description: SHARE_HINTS[value] }))
}

/**
 * One line for who can open a drop now, the same on rows, buttons and panels: its review or quarantine when it has one,
 * otherwise the state, with the days a public link has left.
 */
export function shareStatus(drop: Pick<DropSummary, "share" | "publicUntil" | "shareReview" | "quarantinedAt">, now = Date.now()) {
  if (drop.quarantinedAt) return "Quarantined"
  if (drop.shareReview === "pending") return "Pending review"
  if (drop.shareReview === "rejected") return "Share rejected"
  if (isPublic(drop.share) && drop.publicUntil) return `${SHARE_LABELS[drop.share]} · ${daysUntil(drop.publicUntil, now)}d left`
  return SHARE_LABELS[drop.share]
}

/** What a toast says after someone picks a share. */
export const SHARED_TITLES: Record<Share, string> = {
  private: "Only you now",
  team: "Shared with the team",
  team_edit: "The team can edit it",
  public: "Public link on",
  public_comment: "Public link on, anyone comments",
}
