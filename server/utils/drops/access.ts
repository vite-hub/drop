import type { drops } from "../../databases/config"
import { slugify } from "#shared/links"
import type { DropCrumb, DropSummary } from "#shared/types"
import { expiresAt } from "#shared/expiry"
import { isPublic, type Share, shareLevel } from "#shared/share"
import type { Identity } from "../identity"
import { type Grant, inTeamFolder } from "../nodes"
import { expiryPolicy } from "../expiry"
import { shareNow, sharePolicy } from "../share"
import { onTeam, runsTeam, teamOf } from "../teams"
import type { DropRow } from "./types"
/**
 * What the caller may do with a drop. Admins act on every drop. A share reaches the team (everyone signed in to this
 * Drop, and their agents) or anyone with the link (see #shared/share); "Team can edit" lets people edit in the browser,
 * not their agents, so only the owner and admins publish through agents. A public link waiting for review reaches nobody
 * yet, while the team shares on its path still do. A team folder is the admins' to change; anyone on the team may trash
 * the drops in it. An expired drop is read-only for the people who can renew it and gone for everyone else.
 *
 * On a personal Drop with teams, "the team" is the team whose folders hold the drop (../teams.ts): only its members, and
 * its owner and admins keep its folders.
 */
export function permissions(drop: DropRow, who: Identity | null) {
  const admin = Boolean(who && who.role === "admin")
  if (drop.quarantinedAt)
    return {
      owner: false,
      view: false,
      comment: false,
      edit: false,
      manage: Boolean(who && (who.userId === drop.ownerId || admin)),
      trash: false,
    }
  const owner = Boolean(who && who.userId === drop.ownerId)
  const team = teamOf(drop)
  // On a team Drop, or in a team's folders, a public link waiting for review still reaches the team.
  const held: Share | null = sharePolicy().mode === "team" || team ? "team" : null
  const grants = (drop.grants ?? (drop.share === "private" ? [] : [{ share: drop.share }])).flatMap((grant) =>
    drop.shareReview && isPublic(grant.share) ? (held ? [{ share: held }] : []) : [grant],
  )
  const level = drop.expired ? -1 : Math.max(-1, ...grants.map((grant) => levelFor(grant, drop, who)))
  const available = !drop.ownerBanned
  const live = available && !drop.expired
  const manage = drop.teamFolder ? admin || runsTeam(team, who) : owner || admin
  return {
    owner,
    view: available && (owner || admin || level >= 0),
    comment: live && (owner || admin || level >= 1),
    edit: live && (owner || admin || (level >= 2 && who?.actorKind === "browser")),
    manage,
    // People, not their agents: what an agent reads could steer it to clear out the team's folders.
    trash: manage || (live && who?.actorKind === "browser" && !drop.teamFolder && inTeamFolder(drop) && level >= 0),
  }
}

/** What one share lets the caller do: a public link anyone signed in or not, a team share the drop's team only. */
function levelFor(grant: Grant, drop: DropRow, who: Identity | null) {
  if (isPublic(grant.share)) return shareLevel(grant.share, who !== null)
  return shareLevel(grant.share, onTeam(teamOf(drop), who, sharePolicy().mode === "team"))
}

/** Whether a share on the drop's path includes the caller, review and expiry aside. Team shares need a teammate. */
export const reaches = (drop: DropRow, who: Identity | null) =>
  (drop.grants ?? [{ share: drop.share }]).some((grant: Grant) => levelFor(grant, drop, who) >= 0)

/** A share that worked until its drop expired. Private drops stay indistinguishable from missing ones. */
export const expiredLink = (drop: DropRow | null, who: Identity | null) =>
  Boolean(
    drop?.expired &&
    reaches(drop, who) &&
    !drop.shareReview &&
    !drop.ownerBanned &&
    !drop.quarantinedAt &&
    !permissions(drop, who).view,
  )

/** A public link the caller would see once an admin approves it. Anyone else gets the usual 404. */
export const waitingForReview = (drop: DropRow | null, who: Identity | null) =>
  Boolean(
    drop &&
    !drop.ownerBanned &&
    !drop.quarantinedAt &&
    reaches(drop, who) &&
    drop.shareReview === "pending" &&
    !permissions(drop, who).view,
  )

export function toSummary(row: DropRow, paths?: string[], days = expiryPolicy().days): DropSummary {
  const expires = expiresAt(row, days)
  return {
    id: row.id,
    link: row.id,
    slug: row.slug ?? slugify(row.title),
    kind: row.kind,
    title: row.title,
    filename: row.filename,
    size: row.size,
    version: row.version,
    shareReview: row.shareReview,
    quarantinedAt: row.quarantinedAt,
    share: row.share,
    publicUntil: openUntil(row.raw ?? row),
    actorKind: row.actorKind,
    actorName: row.actorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(paths ? { paths } : {}),
    expiresAt: expires,
    lifetime: row.lifetime,
    keepReason: row.keepReason,
    note: row.note,
    parentId: row.parentId,
    // Past its window but not yet moved by the hourly cleanup: it's in the Trash already, as of when it expired.
    trashedAt: row.trashedAt ?? (row.expired && expires !== null ? expires : null),
    trashReason: row.trashReason ?? (row.expired ? "expired" : null),
    ...(row.kind === "folder" && row.teamFolder ? { teamFolder: true } : {}),
    ...(teamOf(row) ? { team: teamOf(row)! } : {}),
    ...(row.sharedFrom && row.raw ? { sharedFrom: row.sharedFrom, ownShare: row.raw.share } : {}),
  }
}

/** When the drop's own public link closes, while it's open. */
const openUntil = (own: typeof drops.$inferSelect) =>
  isPublic(own.share) && isPublic(shareNow(own)) ? own.publicUntil : null

/** A node as a breadcrumb. */
export const toCrumb = (row: typeof drops.$inferSelect): DropCrumb => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  link: row.id,
  slug: row.slug ?? slugify(row.title),
})
