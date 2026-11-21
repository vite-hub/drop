import type { drops } from "../../databases/default/index"
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
export function permissions(drop: DropRow, who: Identity | null) {
  const admin = Boolean(who && who.role === "admin")
  if (drop.quarantinedAt)
    return {
      owner: false,
      view: false,
      comment: false,
      edit: false,
      manage: Boolean(!drop.draftImage && who && (who.userId === drop.ownerId || admin)),
      trash: false,
    }
  const owner = Boolean(who && who.userId === drop.ownerId)
  const team = teamOf(drop)
  const held: Share | null = sharePolicy().mode === "team" || team ? "team" : null
  const grants = (drop.grants ?? (drop.share === "private" ? [] : [{ share: drop.share }])).flatMap((grant) =>
    drop.shareReview && isPublic(grant.share) ? (held ? [{ share: held }] : []) : [grant],
  )
  const level = drop.expired ? -1 : Math.max(-1, ...grants.map((grant) => levelFor(grant, drop, who)))
  const available = !drop.ownerBanned
  const live = available && !drop.expired
  if (drop.draftImage)
    return {
      owner,
      view:
        live &&
        drop.ancestors?.[0]?.kind === "markdown" &&
        who?.actorKind === "browser" &&
        (owner || admin || level >= 2),
      comment: false,
      edit: false,
      manage: false,
      trash: false,
    }
  const manage = drop.teamFolder ? admin || (who?.actorKind === "browser" && runsTeam(team, who)) : owner || admin
  return {
    owner,
    view: available && (owner || admin || level >= 0),
    comment: live && (owner || admin || level >= 1),
    edit: live && (owner || admin || (level >= 2 && who?.actorKind === "browser")),
    manage,
    trash: manage || (live && who?.actorKind === "browser" && !drop.teamFolder && inTeamFolder(drop) && level >= 0),
  }
}

function levelFor(grant: Grant, drop: DropRow, who: Identity | null) {
  if (isPublic(grant.share)) return shareLevel(grant.share, who !== null)
  return shareLevel(grant.share, onTeam(teamOf(drop), who, sharePolicy().mode === "team"))
}

export const reaches = (drop: DropRow, who: Identity | null) =>
  (drop.grants ?? [{ share: drop.share }]).some((grant: Grant) => levelFor(grant, drop, who) >= 0)

export const expiredLink = (drop: DropRow | null, who: Identity | null) =>
  Boolean(
    drop?.expired &&
    reaches(drop, who) &&
    !drop.shareReview &&
    !drop.ownerBanned &&
    !drop.quarantinedAt &&
    !permissions(drop, who).view,
  )

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
    trashedAt: row.trashedAt ?? (row.expired && expires !== null ? expires : null),
    trashReason: row.trashReason ?? (row.expired ? "expired" : null),
    ...(row.kind === "folder" && row.teamFolder ? { teamFolder: true } : {}),
    ...(row.kind === "link" && row.siteUrl ? { href: row.siteUrl } : {}),
    ...(teamOf(row) ? { team: teamOf(row)! } : {}),
    ...(row.sharedFrom && row.raw ? { sharedFrom: row.sharedFrom, ownShare: row.raw.share } : {}),
  }
}

const openUntil = (own: typeof drops.$inferSelect) =>
  isPublic(own.share) && isPublic(shareNow(own)) ? own.publicUntil : null

export const toCrumb = (row: typeof drops.$inferSelect): DropCrumb => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  link: row.id,
  slug: row.slug ?? slugify(row.title),
})
