import { and, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { db } from "vite-hub/database"
import { useServerEnv } from "vite-hub/env"
import { type DropMode, isPublic, liveShare, publicUntilFrom, type Share, shareBlock } from "#shared/share"
import type { DropKind } from "#shared/types"
import { drops } from "../databases/default/index"
import type { DropRow } from "./drops/types"
import { teamOf, teamsEnabled } from "./teams"

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

export function modeFor(
  node: Pick<DropRow, "teamFolder" | "teamId" | "ancestors"> | null | undefined,
  event?: H3Event,
) {
  const { mode } = sharePolicy(event)
  return mode === "team" || (node && teamOf(node)) ? ("team" as const) : ("personal" as const)
}

export const shareNow = (
  row: { share: Share; publicUntil: number | null },
  now = Date.now(),
  mode: DropMode = sharePolicy().mode,
) => liveShare(row.share, row.publicUntil, mode, now)

export function shareFields(
  share: Share,
  drop: { kind: DropKind; teamFolder?: boolean; team?: boolean },
  event?: H3Event,
  now = Date.now(),
) {
  const policy = sharePolicy(event)
  const { publicLinkDays } = policy
  const mode: DropMode = policy.mode === "team" || drop.team ? "team" : "personal"
  const blocked = shareBlock(share, mode, publicLinkDays, drop, teamsEnabled(event))
  if (blocked) throw new HTTPError({ status: 400, statusText: `${blocked}${nextStep(share, mode)}` })
  return { share, publicUntil: isPublic(share) ? publicUntilFrom(publicLinkDays, now) : null }
}

function nextStep(share: Share, mode: DropMode) {
  if (share === "team_edit" && mode === "team") return " Share it with the team instead."
  return share === "team" || share === "team_edit" ? " Keep it private, or share it with a public link." : ""
}

export async function closePublicLinks(at: Date) {
  const { mode } = sharePolicy()
  const closed = await db
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
    .returning({ id: drops.id })
  return { closed: closed.length }
}
