import { sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { newLink, slugify } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { drops } from "../databases/config"
import { type DropRow, findDropByRef, lifetimeFields, type LifetimeInput, permissions } from "./drops"
import { chainOf } from "./expiry"
import type { Identity } from "./identity"
import { depthOf, heightOf, touchFolder, uniqueSlug } from "./nodes"
import { requireKeepSlot, withDropQuota } from "./quotas"
import { modeFor, shareFields, sharePolicy } from "./share"
import { shareReviewFor } from "./trust"
import { runsTeam, teamOf, teamsEnabled } from "./teams"

/**
 * The folder `ref` names (its id, its link's key, or its share link) when the caller may put something in it: their own
 * folders, or any as an admin. Everyone on the team adds drops to a team folder, people and agents alike; folders go in
 * one only when they're team folders an admin makes in the browser. `moving` is a drop already somewhere that would go
 * in, subtree and all; `adding` says a new folder would.
 */
export async function requireFolder(
  ref: string,
  who: Identity,
  event?: H3Event,
  moving?: DropRow,
  adding: "drop" | "folder" = "drop",
) {
  const folder = await findDropByRef(ref, event)
  const can = folder && permissions(folder, who)
  if (!folder || folder.kind !== "folder" || !can || !(can.manage || (folder.teamFolder && can.view)))
    throw new HTTPError({ status: 404, message: `No folder you can add to with id ${ref}.` })
  if (folder.expired)
    throw new HTTPError({ status: 409, message: `${folder.title} is in the Trash. Restore it first.` })
  if (moving && (folder.id === moving.id || folder.ancestors?.some((node) => node.id === moving.id)))
    throw new HTTPError({ status: 400, statusText: "A folder can't go inside itself." })
  const folderGoesIn = adding === "folder" || moving?.kind === "folder"
  if (folder.teamFolder) {
    if (folderGoesIn && !(moving ? moving.teamFolder : keepsTeamFolders(who, teamOf(folder))))
      throw new HTTPError({
        status: 403,
        statusText: `Only ${teamOf(folder) ? "the team's owner and admins" : "admins"} add folders to ${folder.title}, in the browser. Put the drops in it instead.`,
      })
    if (moving?.teamFolder && teamOf(moving) !== teamOf(folder))
      throw new HTTPError({ status: 400, statusText: "A team folder stays with its team." })
  } else if (moving && (folder.ownerId !== moving.ownerId || moving.teamFolder))
    throw new HTTPError({
      status: 400,
      statusText: moving.teamFolder
        ? "A team folder only goes in another team folder."
        : "A folder holds its owner's drops only.",
    })
  if (depthOf(folder) + (moving ? await heightOf(moving) : 1) > MAX_DEPTH)
    throw new HTTPError({ status: 400, statusText: `Folders nest ${MAX_DEPTH} levels deep at most.` })
  return folder
}

/** Who makes a team's folders, in the browser: on a team Drop its admins; on a personal one the team's owner and admins. */
const keepsTeamFolders = (who: Identity, team: string | null) =>
  who.actorKind === "browser" && (team ? runsTeam(team, who) || who.role === "admin" : who.role === "admin")

/** The longest a folder's description may be: a few paragraphs on what goes in it and how. */
export const MAX_FOLDER_DESCRIPTION = 2000

/**
 * Creates a folder, at the top or inside `folder`. A folder has no file: a title, a link, a description of what goes in
 * it (`note`), and the drops in it, which share and live with it. One inside another folder takes that folder's lifetime.
 * It isn't a drop for the plan's count.
 *
 * A team folder (`team`, or any folder made inside one) is the team's: on a team Drop, admins make it in the browser, it
 * reaches the whole team, and it never expires. On a personal Drop with teams, `teamId` names the team: its owner and
 * admins make its folders, which reach its members only.
 */
export async function createFolder(
  who: Identity,
  input: LifetimeInput & {
    title: string
    slug?: string
    folder?: DropRow
    share?: Share
    team?: boolean
    teamId?: string
  },
  event?: H3Event,
) {
  const title = input.title.trim().slice(0, 160) || "Untitled folder"
  const parent = input.folder ?? null
  const team = Boolean(input.team || input.teamId || parent?.teamFolder)
  const teamDrop = sharePolicy(event).mode === "team"
  const teamId = teamDrop ? null : parent?.teamFolder ? teamOf(parent) : (input.teamId ?? null)
  if (team && !teamDrop && (!teamsEnabled(event) || !teamId))
    throw new HTTPError({
      status: 403,
      statusText: teamsEnabled(event)
        ? "Say which team the folder is for."
        : "Team folders need a team Drop (DROP_MODE=team), or teams (DROP_TEAMS).",
    })
  if (team && !keepsTeamFolders(who, teamId))
    throw new HTTPError({
      status: 403,
      statusText: teamId
        ? "Only the team's owner and admins make its folders, in the browser."
        : "Only admins make team folders, in the browser.",
    })
  if (team && parent && !parent.teamFolder)
    throw new HTTPError({ status: 400, statusText: "A team folder goes at the top, or in another team folder." })
  const ownerId = team ? who.userId : (parent?.ownerId ?? who.userId)
  const life = parent
    ? lifetimeFields(who, {}, parent, event)
    : team
      ? { lifetime: "keep" as const, keepReason: null }
      : lifetimeFields(who, input, null, event)
  await requireKeepSlot(ownerId, life, false, !parent && !team)
  const { share, publicUntil } = input.share
    ? shareFields(
        input.share,
        { kind: "folder", teamFolder: team, team: Boolean(teamId) || modeFor(parent, event) === "team" },
        event,
      )
    : { share: team ? ("team" as const) : defaultShare(modeFor(parent, event)), publicUntil: null }
  const note = input.note?.trim().slice(0, MAX_FOLDER_DESCRIPTION) || null
  return withDropQuota(ownerId, { drops: 0, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const slug = await uniqueSlug(parent?.id ?? null, (input.slug && slugify(input.slug)) || slugify(title))
    const row: DropRow = {
      id: crypto.randomUUID(),
      ownerId,
      kind: "folder",
      title,
      filename: `${slug || "folder"}/`,
      blobKey: null,
      contentType: null,
      size: 0,
      version: 1,
      supersedesId: null,
      link: newLink(),
      slug,
      share,
      publicUntil,
      teamFolder: team,
      teamId,
      shareReview: isPublic(share) ? await shareReviewFor(ownerId, event) : null,
      quarantinedAt: null,
      actorKind: who.actorKind,
      actorName: who.actorName,
      agent: null,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      ...life,
      note,
      trashedAt: null,
      trashReason: null,
      parentId: parent?.id ?? null,
      siteUrl: null,
      publishToken: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(parent ? [touchFolder(parent.id, now)] : [])])
    return row
  })
}

/**
 * Moves a drop, every version of it, into a folder, or to the top with null. From then on it shares and lives with
 * its new ancestors, and its slug gets a number if the folder has one like it. A drop leaving the folders keeps the
 * lifetime it lived by, from now, so it doesn't expire on the spot.
 */
export async function moveNode(drop: DropRow, ref: string | null, who: Identity, event?: H3Event) {
  const target = ref ? await requireFolder(ref, who, event, drop) : null
  if ((target?.id ?? null) === drop.parentId) return
  const now = Date.now()
  const own = drop.raw ?? drop
  const slug = await uniqueSlug(target?.id ?? null, own.slug ?? slugify(own.title), own.link)
  const life = target ? {} : { lifetime: drop.lifetime, keepReason: drop.keepReason, lastAccessedAt: now }
  await db
    .update(drops)
    .set({ parentId: target?.id ?? null, slug, ...life })
    .where(sql`${drops.id} IN (${chainOf(drop)})`)
  if (target) await touchFolder(target.id, now)
}
