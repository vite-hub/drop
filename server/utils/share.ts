import { and, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { type DropMode, isPublic, liveShare, publicUntilFrom, type Share, sharesFor } from "#shared/share"
import type { DropKind } from "#shared/types"
import { drops } from "../databases/config"
import type { DropRow } from "./drops/types"
import { teamOf, teamsEnabled } from "./teams"

/** How this Drop shares (`DROP_MODE`, `DROP_PUBLIC_LINK_DAYS`): its mode, and days a public link stays open. */
export function sharePolicy(event?: H3Event): { mode: DropMode; publicLinkDays: number | null } {
  const { mode, publicLinkDays } = useServerEnv(event).drop
  const days = publicLinkDays.trim()
  const resolvedMode: DropMode = mode === "team" ? "team" : "personal"
  if (!days) return { mode: resolvedMode, publicLinkDays: resolvedMode === "team" ? 7 : null }
  const value = Number(days)
  if (!Number.isInteger(value) || value < 0)
    throw new Error("DROP_PUBLIC_LINK_DAYS must be a whole number of days, or 0 to turn public links off.")
  return { mode: resolvedMode, publicLinkDays: value }
}

/**
 * The mode a drop shares under: this Drop's, except that inside a team's folders a personal Drop shares like a team one,
 * with that team (./teams.ts).
 */
export function modeFor(
  node: Pick<DropRow, "teamFolder" | "teamId" | "ancestors"> | null | undefined,
  event?: H3Event,
) {
  const { mode } = sharePolicy(event)
  return mode === "team" || (node && teamOf(node)) ? ("team" as const) : ("personal" as const)
}

/** A row's share in force now, under this Drop's mode or the one its place gives it (`modeFor`). */
export const shareNow = (
  row: { share: Share; publicUntil: number | null },
  now = Date.now(),
  mode: DropMode = sharePolicy().mode,
) => liveShare(row.share, row.publicUntil, mode, now)

/**
 * The columns a share change writes, after checking this Drop offers it for the drop. Making a link public starts its
 * window now; any other share clears it. `team` says the drop is in a team's folders on a personal Drop.
 */
export function shareFields(
  share: Share,
  drop: { kind: DropKind; teamFolder?: boolean; team?: boolean },
  event?: H3Event,
  now = Date.now(),
) {
  const policy = sharePolicy(event)
  const { publicLinkDays } = policy
  const mode: DropMode = policy.mode === "team" || drop.team ? "team" : "personal"
  if (!sharesFor(mode, publicLinkDays, drop).includes(share))
    throw new HTTPError({ status: 400, statusText: shareRefusal(share, mode) })
  return { share, publicUntil: isPublic(share) ? publicUntilFrom(publicLinkDays, now) : null }
}

function shareRefusal(share: Share, mode: DropMode) {
  if (share === "private") return "A team folder is the team's: it can't be private."
  if (isPublic(share)) return "Public links are off on this Drop."
  if (mode !== "team")
    return teamsEnabled()
      ? "Only drops in a team's folders share with a team. Keep it private, or share it with a public link."
      : "This Drop is personal: keep it private, or share it with a public link."
  return "Only Markdown docs and folders can be edited together; share it with the team instead."
}

/**
 * Writes down the public links that closed: each becomes the share it fell back to. Reads already treat them as closed
 * (`shareNow`); this keeps the stored state honest for queries and exports. Runs with the hourly cleanup.
 */
export async function closePublicLinks(at: Date) {
  const { mode } = sharePolicy()
  // A team folder is never private: on a personal Drop too, it goes back to its team.
  await db
    .update(drops)
    .set({
      share: mode === "team" ? "team" : sql`CASE WHEN ${drops.teamFolder} = 1 THEN 'team' ELSE 'private' END`,
      publicUntil: null,
      shareReview: null,
    })
    .where(
      and(
        inArray(drops.share, ["public", "public_comment"]),
        isNotNull(drops.publicUntil),
        lte(drops.publicUntil, at.getTime()),
      ),
    )
}
