import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { chunkParameters, db } from "vite-hub/database"
import type {
  DropAttachment,
  DropCrumb,
  DropDetail,
  DropGalleryItem,
  DropKind,
  DropSummary,
  DropTree,
  DropVersion,
} from "#shared/types"
import { TREE_ROWS } from "#shared/types"
import { isPublic } from "#shared/share"
import { DAY_MS } from "#shared/expiry"
import { MAX_DEPTH } from "#shared/nodes"
import { isTextFile } from "#shared/project-bundle"
import { shareReviewFor } from "../trust"
import { LIVE_EDITING } from "../live-drafts"
import { expiryPolicy } from "../expiry"
import {
  ancestorsOf,
  foldersUnder,
  isAttachment,
  itemCounts,
  listedNode,
  parentNode,
  resolveNode,
  rootOf,
  walkUp,
  withAncestors,
} from "../nodes"
import { modeFor, shareNow, sharePolicy } from "../share"
import { searchDrops, searchWords } from "../search"
import { resourcesOf } from "../resources"
import { answerable, quizOf } from "../answers"
import { viewsOf } from "../views"
import { dropExcerpt } from "../og"
import { dropFiles, dropPins, drops, dropVersions, dropVisits, user } from "../../databases/default/index"
import type { Identity } from "../identity"
import { logDrop, logError } from "../logs"
import type { DropRow } from "./types"
import { permissions, toCrumb, toSummary } from "./access"
import { liveEditorKeeps } from "../live-editor"
const TEXT_KINDS = new Set(["markdown", "html"])

async function findOne(hit: SQL, event?: H3Event): Promise<DropRow | null> {
  const rows = await db
    .select({ drop: drops, owner: user, hit: sql<number>`${drops.id} = (${hit})` })
    .from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId))
    .where(inArray(drops.id, withAncestors(hit)))
  const row = rows.find((item) => item.hit)
  if (!row) return null
  const ancestors = row.drop.parentId
    ? walkUp([row.drop], new Map(rows.map((item) => [item.drop.id, item.drop]))).get(row.drop.id)!
    : []
  const found = await currentReview(
    {
      ...resolveNode(row.drop, ancestors, expiryPolicy(event).days),
      ownerBanned: !row.owner || Boolean(row.owner.banned),
      ...(row.owner ? { ownerProfile: { name: row.owner.name, image: row.owner.image } } : {}),
    },
    row.owner,
    event,
  )
  logDrop(event, found)
  return found
}

export async function currentReview(drop: DropRow, owner: typeof user.$inferSelect | null, event?: H3Event) {
  if (event && drop.shareReview && (await shareReviewFor(drop.ownerId, event, owner)) === null) drop.shareReview = null
  return drop
}

async function resolveRows(rows: (typeof drops.$inferSelect)[], days: number) {
  const ancestors = await ancestorsOf(rows)
  return rows.map((row) => resolveNode(row, ancestors.get(row.id) ?? [], days))
}

async function summarize(
  rows: DropRow[],
  days: number,
  options: {
    ownerId?: string
    path?: boolean
    below?: string
    snippets?: Map<string, string | undefined>
    folderIds?: SQL
  } = {},
) {
  const [files, counts] = await Promise.all([
    options.ownerId && rows.some((row) => row.kind === "app")
      ? db
          .select({ dropId: dropFiles.dropId, path: dropFiles.path })
          .from(dropFiles)
          .innerJoin(drops, eq(drops.id, dropFiles.dropId))
          .where(eq(drops.ownerId, options.ownerId))
      : [],
    itemCounts(
      rows.some((row) => row.kind === "folder") && options.folderIds
        ? options.folderIds
        : rows.flatMap((row) => (row.kind === "folder" ? [row.id] : [])),
    ),
  ])
  const pathsOf = (id: string) =>
    files
      .filter((file) => file.dropId === id)
      .map((file) => file.path)
      .sort()
  const pathOf = (row: DropRow) => {
    const above = row.ancestors ?? []
    const stop = options.below ? above.findIndex((node) => node.id === options.below) : -1
    return (stop === -1 ? above : above.slice(0, stop)).map(toCrumb).reverse()
  }
  return rows.map((row) => ({
    ...toSummary(row, row.kind === "app" ? pathsOf(row.id) : undefined, days),
    ...(row.kind === "folder" ? { items: counts.get(row.id) ?? 0 } : {}),
    ...(row.kind === "image" && row.blobKey ? { thumbnail: `/f/${row.blobKey}` } : {}),
    ...(options.path ? { path: pathOf(row) } : {}),
    ...(options.snippets?.get(row.id) ? { snippet: options.snippets.get(row.id) } : {}),
  }))
}

const newest = (where: SQL | undefined, limit: number) =>
  db.select().from(drops).where(where).orderBy(desc(drops.updatedAt)).limit(limit)

async function dropsMatching(where: SQL | undefined, words: string[], limit: number) {
  if (!words.length) return { rows: await newest(where, limit), snippets: undefined }
  const found = await searchDrops(where, words, limit)
  return { rows: found.map((item) => item.drop), snippets: new Map(found.map((item) => [item.drop.id, item.snippet])) }
}

export function findDrop(id: string, event?: H3Event) {
  return findOne(sql`${id}`, event)
}

export async function findDropByRef(ref: string, event?: H3Event) {
  const link = ref.trim().match(/\/d\/([^/?#]+)[^?#]*(?:\?(?:[^#]*&)?v=(\d+))?/)
  if (!link) return findDrop(ref.trim(), event)
  return findDropAt(link[1]!, link[2] ? Number(link[2]) : undefined, event)
}

export async function findDropAt(id: string, version?: number, event?: H3Event) {
  const [row, older] = await Promise.all([
    findDrop(id, event),
    version
      ? db
          .select()
          .from(dropVersions)
          .where(and(eq(dropVersions.dropId, id), eq(dropVersions.version, version)))
          .limit(1)
      : [],
  ])
  if (!row || !version || version === row.version) return row
  return older[0] ? atVersion(row, older[0]) : null
}

function atVersion(row: DropRow, older: typeof dropVersions.$inferSelect): DropRow {
  const { dropId: _, ...fields } = older
  return { ...row, ...fields, head: row.head ?? row.raw ?? row }
}

export async function findDropByBlob(key: string, event?: H3Event) {
  const found = await findOne(
    sql`coalesce((SELECT id FROM drops WHERE blob_key = ${key}), (SELECT drop_id FROM drop_versions WHERE blob_key = ${key}))`,
    event,
  )
  if (!found || found.blobKey === key) return found
  const [older] = await db.select().from(dropVersions).where(eq(dropVersions.blobKey, key)).limit(1)
  return older ? atVersion(found, older) : null
}

const ofKinds = (kinds?: DropKind[]) => (kinds?.length ? inArray(drops.kind, kinds) : undefined)

export async function listDrops(
  who: Identity,
  event?: H3Event,
  options: { trash?: boolean; query?: string; kinds?: DropKind[]; limit?: number } = {},
): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const deep = words.length > 0 || Boolean(options.kinds?.length)
  const scope = options.trash
    ? and(listedNode, or(isNull(drops.parentId), isNotNull(drops.trashedAt)))
    : deep
      ? and(listedNode, ofKinds(options.kinds))
      : and(isNull(drops.parentId), eq(drops.teamFolder, false))
  const found = await dropsMatching(and(eq(drops.ownerId, who.userId), scope), words, options.limit ?? 500)
  const rows = await resolveRows(found.rows, days)
  const listed = rows.filter((row) => (options.trash ? row.expired && !parentNode(row, days)?.expired : !row.expired))
  return summarize(listed, days, { ownerId: who.userId, path: deep, snippets: found.snippets })
}

export async function listTree(who: Identity, event?: H3Event, open?: string): Promise<DropTree> {
  const { days } = expiryPolicy(event)
  const found = await newest(
    and(eq(drops.ownerId, who.userId), isNull(drops.parentId), eq(drops.teamFolder, false)),
    500,
  )
  const rows = (await resolveRows(found, days)).filter((row) => !row.expired)
  const listed = rows.filter((row, index) => index < TREE_ROWS || row.id === open)
  return { drops: await summarize(listed, days, { ownerId: who.userId }), total: rows.length }
}

export async function listFolder(
  folder: DropRow,
  event?: H3Event,
  options: { query?: string; kinds?: DropKind[]; who?: Identity | null; limit?: number } = {},
): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const deep = words.length > 0 || Boolean(options.kinds?.length)
  const inside = deep ? inArray(drops.parentId, foldersUnder(folder.id)) : eq(drops.parentId, folder.id)
  const owned = folder.teamFolder ? undefined : eq(drops.ownerId, folder.ownerId)
  const found = await dropsMatching(
    and(owned, inside, ofKinds(options.kinds), isNull(drops.trashedAt)),
    words,
    Math.min(options.limit ?? 500, deep ? 200 : 500),
  )
  const above = [folder.raw ?? folder, ...(folder.ancestors ?? [])]
  const rows = deep ? await resolveRows(found.rows, days) : found.rows.map((row) => resolveNode(row, above, days))
  const listed = rows
    .filter((row) => folder.expired || !row.expired)
    .map((row) => ({ ...row, ownerBanned: folder.ownerBanned }))
  const summaries = await summarize(listed, days, {
    ownerId: folder.teamFolder ? undefined : folder.ownerId,
    path: deep,
    below: folder.id,
    snippets: found.snippets,
  })
  if (!folder.teamFolder) return summaries
  const ownerIds = [...new Set(listed.map((row) => row.ownerId).filter((id) => id !== options.who?.userId))]
  const owners = new Map<string, { name: string; image: string | null }>()
  for (const chunk of chunkParameters(ownerIds, { reserved: 10 }))
    for (const row of await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(inArray(user.id, chunk)))
      owners.set(row.id, { name: row.name, image: row.image })
  const ownerOf = new Map(listed.map((row) => [row.id, row.ownerId]))
  return summaries.map((summary) => {
    const owner = owners.get(ownerOf.get(summary.id)!)
    return owner && !summary.teamFolder ? { ...summary, owner } : summary
  })
}

async function galleryOf(row: DropRow, who: Identity | null, days: number): Promise<DropGalleryItem[] | undefined> {
  const [parent, ...above] = row.ancestors ?? []
  if (row.kind !== "image" || parent?.kind !== "folder") return undefined
  const folder = { ...resolveNode(parent, above, days), ownerBanned: row.ownerBanned }
  if (!permissions(folder, who).view) return undefined
  const owned = folder.teamFolder ? undefined : eq(drops.ownerId, folder.ownerId)
  const images = (
    await newest(and(owned, eq(drops.parentId, parent.id), eq(drops.kind, "image"), isNull(drops.trashedAt)), 500)
  )
    .map((image) => resolveNode(image, [parent, ...above], days))
    .filter((image) => (folder.expired || !image.expired) && image.blobKey)
  if (images.length < 2 || !images.some((image) => image.id === row.id)) return undefined
  return images.map((image) => ({ ...toCrumb(image), thumbnail: `/f/${image.blobKey}` }))
}

export async function listFolders(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const mine = and(eq(drops.ownerId, who.userId), eq(drops.teamFolder, false))
  const rows = await resolveRows(
    await newest(and(eq(drops.kind, "folder"), or(mine, teamFolderSql(`"drops"`, who, event))), 500),
    days,
  )
  return summarize(
    rows.filter((row) => !row.expired && !row.quarantinedAt),
    days,
    { path: true },
  )
}

function teamFolderSql(node: string, who: Identity, event?: H3Event) {
  const at = sql.raw(node)
  if (sharePolicy(event).mode === "team") return sql`(${at}.team_folder = 1)`
  const teams = Object.keys(who.teams ?? {})
  if (!teams.length) return sql`0`
  return sql`(${at}.team_folder = 1 AND ${at}.team_id IN (${sql.join(
    teams.map((team) => sql`${team}`),
    sql`, `,
  )}))`
}

function reachableSql(node: string, who: Identity, now: number, event?: H3Event) {
  const at = sql.raw(node)
  if (sharePolicy(event).mode === "team") return sql`(${at}.share != 'private')`
  return sql`(${at}.share IN ('public', 'public_comment') AND ${at}.share_review IS NULL AND (${at}.public_until IS NULL OR ${at}.public_until > ${now})
    AND EXISTS (SELECT 1 FROM drop_visits v WHERE v.user_id = ${who.userId} AND v.drop_id = ${at}.id))`
}

export async function listSharedWithMe(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const now = Date.now()
  const others = and(ne(drops.ownerId, who.userId), reachableSql(`"drops"`, who, now, event))
  const rows = await db
    .select({ drop: drops, ownerName: user.name, ownerImage: user.image })
    .from(drops)
    .innerJoin(user, eq(user.id, drops.ownerId))
    .where(
      and(
        or(others, and(teamFolderSql(`"drops"`, who, event), isNull(drops.parentId))),
        listedNode,
        isNull(drops.trashedAt),
        isNull(drops.quarantinedAt),
        sql`coalesce(${user.banned}, 0) = 0`,
      ),
    )
    .orderBy(desc(drops.updatedAt))
    .limit(200)
  const { days } = expiryPolicy(event)
  const ancestors = await ancestorsOf(rows.map((row) => row.drop))
  const listed = new Set(rows.map((row) => row.drop.id))
  const owners = new Map(rows.map((row) => [row.drop.id, { name: row.ownerName, image: row.ownerImage }]))
  const nodes = rows
    .map((row) => resolveNode(row.drop, ancestors.get(row.drop.id) ?? [], days, now))
    .filter(
      (node) =>
        !node.expired &&
        !node.quarantinedAt &&
        (modeFor(node, event) === "team" || !node.shareReview) &&
        !node.ancestors!.some(
          (above) =>
            listed.has(above.id) || (modeFor(node, event) === "team" && shareNow(above, now, "team") !== "private"),
        ),
    )
    .sort((a, b) => Number(b.teamFolder) - Number(a.teamFolder))
  return (await summarize(nodes, days)).map((summary) => ({
    ...summary,
    ...(summary.teamFolder ? {} : { owner: owners.get(summary.id)! }),
  }))
}

export async function listPinned(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const pinnedIds = sql`SELECT ${dropPins.dropId} FROM ${dropPins} WHERE ${dropPins.userId} = ${who.userId}`
  const rows = await db
    .select({ drop: drops, owner: user })
    .from(dropPins)
    .innerJoin(drops, eq(drops.id, dropPins.dropId))
    .innerJoin(user, eq(user.id, drops.ownerId))
    .where(and(eq(dropPins.userId, who.userId), isNull(drops.trashedAt)))
    .orderBy(desc(dropPins.at), desc(dropPins.dropId))
  const { days } = expiryPolicy(event)
  const owners = new Map(rows.map(({ drop, owner }) => [drop.id, owner]))
  const dropsToResolve = rows.map(({ drop }) => drop)
  const ancestorRows = dropsToResolve.some((drop) => drop.parentId)
    ? await db
        .select()
        .from(drops)
        .where(inArray(drops.id, withAncestors(pinnedIds)))
    : []
  const ancestors = walkUp(dropsToResolve, new Map(ancestorRows.map((drop) => [drop.id, drop])))
  const resolved = dropsToResolve.map((drop) => resolveNode(drop, ancestors.get(drop.id) ?? [], days))
  const nodes = (
    await Promise.all(
      resolved.map((node) => {
        const owner = owners.get(node.id)!
        return currentReview({ ...node, ownerBanned: Boolean(owner.banned) }, owner, event)
      }),
    )
  ).filter((node) => canPinDrop(node, who))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (await summarize(nodes, days, { ownerId: who.userId, folderIds: sql`(${pinnedIds})` })).map((summary) => {
    const node = byId.get(summary.id)!
    const path = openableAncestors(node, who, days)
    return {
      ...summary,
      pinned: true,
      ...(path.length ? { path } : {}),
      ...(node.ownerId === who.userId || summary.teamFolder
        ? {}
        : { owner: { name: owners.get(node.id)!.name, image: owners.get(node.id)!.image } }),
    }
  })
}

export const canPinDrop = (drop: DropRow, who: Identity) =>
  !drop.expired && !isAttachment(drop) && permissions(drop, who).view

async function isPinned(dropId: string, who: Identity) {
  const [row] = await db
    .select({ at: dropPins.at })
    .from(dropPins)
    .where(and(eq(dropPins.userId, who.userId), eq(dropPins.dropId, dropId)))
  return Boolean(row)
}

export async function setPinned(dropId: string, who: Identity, pinned: boolean) {
  if (pinned) await db.insert(dropPins).values({ userId: who.userId, dropId, at: Date.now() }).onConflictDoNothing()
  else await db.delete(dropPins).where(and(eq(dropPins.userId, who.userId), eq(dropPins.dropId, dropId)))
}

async function searchShared(
  who: Identity,
  words: string[],
  kinds: DropKind[],
  limit: number,
  event?: H3Event,
): Promise<DropSummary[]> {
  const now = Date.now()
  const team = sharePolicy(event).mode === "team"
  const reachable = (node: string) => reachableSql(node, who, now, event)
  const openFolders = sql`(
    WITH RECURSIVE open(id, depth) AS (
      SELECT d.id, 0 FROM drops d WHERE d.kind = 'folder' AND ((d.owner_id != ${who.userId} AND ${reachable("d")}) OR ${teamFolderSql("d", who, event)})
        AND d.trashed_at IS NULL AND d.quarantined_at IS NULL
      UNION ALL SELECT d.id, open.depth + 1 FROM drops d JOIN open ON d.parent_id = open.id WHERE d.kind = 'folder' AND open.depth < ${MAX_DEPTH}
    ) SELECT id FROM open
  )`
  const found = await searchDrops(
    and(
      ne(drops.ownerId, who.userId),
      listedNode,
      ofKinds(kinds),
      isNull(drops.trashedAt),
      isNull(drops.quarantinedAt),
      team ? undefined : isNull(drops.shareReview),
      or(reachable(`"drops"`), inArray(drops.parentId, openFolders)),
      sql`EXISTS (SELECT 1 FROM user u WHERE u.id = ${drops.ownerId} AND coalesce(u.banned, 0) = 0)`,
    ),
    words,
    limit,
  )
  const { days } = expiryPolicy(event)
  const nodes = (
    await resolveRows(
      found.map((item) => item.drop),
      days,
    )
  ).filter((node) => !node.expired && !node.quarantinedAt && permissions(node, who).view)
  const ownerIds = [...new Set(nodes.map((node) => node.ownerId))]
  const owners = new Map<string, { name: string; image: string | null }>()
  for (const chunk of chunkParameters(ownerIds, { reserved: 10 }))
    for (const row of await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(inArray(user.id, chunk)))
      owners.set(row.id, { name: row.name, image: row.image })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const summaries = await summarize(nodes, days, {
    snippets: new Map(found.map((item) => [item.drop.id, item.snippet])),
  })
  return summaries.map((summary) => ({
    ...summary,
    path: openableAncestors(byId.get(summary.id)!, who, days),
    owner: owners.get(byId.get(summary.id)!.ownerId)!,
  }))
}

export async function searchEverything(
  who: Identity,
  query: string,
  event?: H3Event,
  options: { kinds?: DropKind[]; limit?: number } = {},
): Promise<DropSummary[]> {
  const { kinds = [], limit = 30 } = options
  const words = searchWords(query)
  if (!words.length && !kinds.length) return []
  return [
    ...(await listDrops(who, event, { query, kinds, limit })),
    ...(await searchShared(who, words, kinds, limit, event)),
  ]
}

export async function recordSharedVisit(drop: DropRow, who: Identity | null, event?: H3Event) {
  if (!who || who.actorKind !== "browser" || who.userId === drop.ownerId || !isPublic(drop.share) || isAttachment(drop))
    return
  const at = Date.now()
  try {
    await db
      .insert(dropVisits)
      .values({ userId: who.userId, dropId: drop.id, at })
      .onConflictDoUpdate({
        target: [dropVisits.userId, dropVisits.dropId],
        set: { at },
        setWhere: lte(dropVisits.at, at - DAY_MS),
      })
  } catch (error) {
    logError(event, error, { action: "drop-shared-visit" })
  }
}

export function storageFailure(error: unknown) {
  return new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable.", cause: error })
}

async function readFile(key: string) {
  const [error, file] = await blob.get(key)
  if (error && error.code !== "BLOB_NOT_FOUND") throw storageFailure(error)
  if (!file) throw new HTTPError({ status: 404, statusText: "File content is missing." })
  return file
}

export const readText = async (key: string) => (await readFile(key)).text()

export const readBytes = async (key: string) => new Uint8Array(await (await readFile(key)).arrayBuffer())

export function liveEditable(row: DropRow, who: Identity | null) {
  return (
    LIVE_EDITING && who?.actorKind === "browser" && permissions(row, who).edit && row.kind === "markdown" && !row.head
  )
}

export async function versionsOf(row: DropRow, who: Identity | null = null): Promise<DropVersion[]> {
  const head = row.head ?? row.raw ?? row
  const older = await db
    .select()
    .from(dropVersions)
    .where(eq(dropVersions.dropId, row.id))
    .orderBy(desc(dropVersions.version))
    .limit(99)
  return [head, ...older].map((item) => ({
    title: item.title,
    version: item.version,
    createdAt: item.createdAt,
    note: item.note,
    actorName: item.actorName,
    agent: versionAgent(item.agent, who?.userId === row.ownerId),
    current: item.version === row.version,
  }))
}

function versionAgent(agent: DropVersion["agent"], isOwner: boolean): DropVersion["agent"] {
  if (isOwner || !agent?.session) return agent
  const { session: _session, ...attribution } = agent
  return attribution
}

type AppText = "all" | "none" | "agent"
const AGENT_FILE_BYTES = 64 * 1024
const AGENT_FILES = 40

async function ownerProfileOf(id: string) {
  const [row] = await db.select({ name: user.name, image: user.image }).from(user).where(eq(user.id, id)).limit(1)
  return row ?? null
}

export async function dropDetail(
  row: DropRow,
  who: Identity | null,
  origin: string,
  event?: H3Event,
  appText: AppText = "all",
): Promise<DropDetail> {
  const can = permissions(row, who)
  if (!can.view) throw new HTTPError({ status: 404, statusText: "Not found" })
  const { days } = expiryPolicy(event)
  const [versions, body, attachments, views, quiz, gallery, owner, pinned] = await Promise.all([
    versionsOf(row, who),
    bodyOf(row, who, origin, event, appText),
    TEXT_KINDS.has(row.kind) ? attachmentsOf(row, origin) : undefined,
    can.manage && !isAttachment(row) ? viewsOf(row) : undefined,
    who && answerable(row, who) ? quizOf(row, who.userId, event) : undefined,
    galleryOf(row, who, days),
    who ? (row.ownerProfile ?? ownerProfileOf(row.ownerId)) : null,
    who && canPinDrop(row, who) ? isPinned(row.id, who) : false,
  ])
  const resources = isAttachment(row) ? [] : resourcesOf(row)
  const detail: DropDetail = {
    ...toSummary(row, undefined, days),
    ...(rootOf(row).teamFolder ? { lifetimeFixed: true } : {}),
    isOwner: can.manage,
    canTrash: can.trash,
    canComment: can.comment,
    canEdit: liveEditable(row, who),
    versions,
    ancestors: openableAncestors(row, who, days),
    ...(row.kind === "image" && row.ancestors?.[0]?.kind === "site" ? { siteScreenshot: true } : {}),
    ...body,
  }
  if (detail.canEdit && row.kind === "markdown" && !(await liveEditorKeeps(row.blobKey, detail.content ?? ""))) {
    detail.canEdit = false
    detail.editNote = "Saving it from the live editor would change how parts of it read."
  }
  if (attachments) detail.attachments = attachments
  if (row.kind === "site" && row.siteUrl) detail.siteUrl = row.siteUrl
  if (views) detail.views = views
  if (resources.length) detail.resources = resources
  if (quiz) detail.quiz = quiz
  if (gallery) detail.gallery = gallery
  if (owner) detail.owner = owner
  if (pinned) detail.pinned = true
  return detail
}

async function bodyOf(
  row: DropRow,
  who: Identity | null,
  origin: string,
  event: H3Event | undefined,
  appText: AppText,
): Promise<Partial<DropDetail>> {
  const detail: Partial<DropDetail> = {}
  if (row.kind === "folder") {
    detail.children = await listFolder(row, event, { who })
    detail.items = detail.children.length
  }
  if (row.kind === "app") {
    const files = await db.select().from(dropFiles).where(eq(dropFiles.dropId, row.id))
    if (appText !== "none") {
      const read = files
        .filter((file) => isTextFile(file.path) && (appText === "all" || file.size <= AGENT_FILE_BYTES))
        .slice(0, appText === "agent" ? AGENT_FILES : undefined)
      detail.files = Object.fromEntries(
        await Promise.all(read.map(async (file) => [file.path, await readText(file.blobKey)] as const)),
      )
    }
    detail.paths = files.map((file) => file.path).sort()
    detail.sizes = Object.fromEntries(files.map((file) => [file.path, file.size]))
  } else if (row.blobKey) {
    if (row.kind === "markdown") {
      const { renderMarkdownCached, withDocProperties } = await import("../markdown-document")
      const rendered = await renderMarkdownCached(row.blobKey, () => readText(row.blobKey!), event)
      detail.content = rendered.source
      const { absoluteFavicons } = await import("../favicons")
      detail.html = absoluteFavicons(
        await withDocProperties(rendered.html, {
          resources: isAttachment(row) ? [] : resourcesOf(row),
          updatedAt: row.createdAt,
        }),
        origin,
      )
    } else if (TEXT_KINDS.has(row.kind)) detail.content = await readText(row.blobKey)
    else if (row.kind === "file") {
      const sheets = await import("../spreadsheet")
      const extension = sheets.spreadsheetExtension(row.filename)
      const key = row.blobKey
      if (sheets.SPREADSHEET_EXTENSIONS.has(extension))
        detail.html = await sheets.renderSpreadsheetCached(key, extension, () => readBytes(key), event)
    }
    detail.url = new URL(`/f/${row.blobKey}?raw`, origin).href
  }
  detail.excerpt = await dropExcerpt(row, detail.content)
  return detail
}

function openableAncestors(row: DropRow, who: Identity | null, days: number): DropCrumb[] {
  const above = row.ancestors ?? []
  return above
    .filter(
      (node, index) =>
        permissions({ ...resolveNode(node, above.slice(index + 1), days), ownerBanned: row.ownerBanned }, who).view,
    )
    .map(toCrumb)
    .reverse()
}

const notCommentImage = sql`NOT EXISTS (SELECT 1 FROM comment_attachments WHERE comment_attachments.drop_id = ${drops.id})`

async function attachmentsOf(row: DropRow, origin: string): Promise<DropAttachment[]> {
  const rows = await db
    .select()
    .from(drops)
    .where(and(eq(drops.parentId, row.id), isNotNull(drops.blobKey), eq(drops.draftImage, false), notCommentImage))
    .limit(100)
  return rows.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    filename: item.filename,
    size: item.size,
    url: new URL(`/f/${item.blobKey}`, origin).href,
  }))
}
