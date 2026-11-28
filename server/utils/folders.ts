import { eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { db } from "vite-hub/database"
import { newLink, slugify } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { drops } from "../databases/default/index"
import { type DropRow, findDropByRef, lifetimeFields, type LifetimeInput, permissions } from "./drops"
import type { Identity } from "./identity"
import { logDrop } from "./logs"
import { depthOf, heightOf, touchFolder, uniqueSlug } from "./nodes"
import { requireKeepSlot, withDropQuota } from "./quotas"
import { modeFor, shareFields, sharePolicy } from "./share"
import { shareReviewFor } from "./trust"
import { runsTeam, teamOf, teamsEnabled } from "./teams"

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

const keepsTeamFolders = (who: Identity, team: string | null) =>
  who.actorKind === "browser" && (team ? runsTeam(team, who) || who.role === "admin" : who.role === "admin")

export const MAX_FOLDER_DESCRIPTION = 2000

export async function createFolder(
  who: Identity,
  input: LifetimeInput & {
    title: string
    slug?: string
    folder?: DropRow
    share?: Share
    team?: boolean
    teamId?: string
    role?: "notes-folder"
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
    : team || input.role
      ? { lifetime: "keep" as const, keepReason: null }
      : lifetimeFields(who, input, null, event)
  await requireKeepSlot(ownerId, life, false, !parent && !team && !input.role)
  const { share, publicUntil } = input.role
    ? { share: "private" as const, publicUntil: null }
    : input.share
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
      id: newLink(),
      ownerId,
      kind: "folder",
      title,
      filename: `${slug || "folder"}/`,
      blobKey: null,
      contentType: null,
      size: 0,
      version: 1,
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
      sessionPublisherId: null,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      ...life,
      note,
      trashedAt: null,
      trashReason: null,
      parentId: parent?.id ?? null,
      parentVersion: null,
      siteUrl: null,
      publishToken: null,
      draftImage: false,
      resources: null,
      role: input.role ?? null,
    }
    await quota.commit([db.insert(drops).values(row), ...(parent ? [touchFolder(parent.id, now)] : [])])
    logDrop(event, row, { change: "create" })
    return row
  })
}

export async function moveNode(drop: DropRow, ref: string | null, who: Identity, event?: H3Event) {
  const target = ref ? await requireFolder(ref, who, event, drop) : null
  if ((target?.id ?? null) === drop.parentId) return
  const now = Date.now()
  const own = drop.raw ?? drop
  const slug = await uniqueSlug(target?.id ?? null, own.slug ?? slugify(own.title), own.id)
  const life = target ? {} : { lifetime: drop.lifetime, keepReason: drop.keepReason, lastAccessedAt: now }
  await db
    .update(drops)
    .set({ parentId: target?.id ?? null, slug, ...life })
    .where(eq(drops.id, drop.id))
  if (target) await touchFolder(target.id, now)
}
