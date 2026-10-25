import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { renderMarkdownCached } from "../markdown-document"
import { renderSpreadsheetCached, SPREADSHEET_EXTENSIONS, spreadsheetExtension } from "../spreadsheet"
import type { DropAttachment, DropCrumb, DropDetail, DropKind, DropSummary, DropVersion } from "#shared/types"
import { isPublic } from "#shared/share"
import { DAY_MS } from "#shared/expiry"
import { hasEditorlessSyntax } from "#shared/frontmatter"
import { MAX_DEPTH } from "#shared/nodes"
import { isTextFile } from "#shared/project-bundle"
import { shareReviewFor } from "../trust"
import { LIVE_EDITING } from "#live-drafts"
import { chainOf, expiryPolicy } from "../expiry"
import {
  ancestorsOf,
  foldersUnder,
  isAttachment,
  itemCounts,
  listedNode,
  parentNode,
  resolveNode,
  walkUp,
  withAncestors,
} from "../nodes"
import { modeFor, shareNow, sharePolicy } from "../share"
import { searchHeads, searchWords } from "../search"
import { resourcesOf } from "../resources"
import { viewsOf } from "../views"
import { dropExcerpt } from "../og"
import { dropFiles, dropHeads, drops, dropVisits, user } from "../../databases/config"
import type { Identity } from "../identity"
import type { DropRow } from "./types"
import { permissions, toCrumb, toSummary } from "./access"
const TEXT_KINDS = new Set(["markdown", "html"])

/**
 * The drop `hit` selects (a query for at most one id) with its owner, and the ancestors of a drop in a folder or a file a
 * doc embeds, which it is shared, kept, and trashed with (see ./nodes): one query, whatever the depth. Review policy
 * reuses the joined owner, so it adds none.
 */
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
  const drop: DropRow = {
    ...resolveNode(row.drop, ancestors, expiryPolicy(event).days),
    ownerBanned: !row.owner || Boolean(row.owner.banned),
  }
  if (event && drop.shareReview && (await shareReviewFor(drop.ownerId, event, row.owner)) === null)
    drop.shareReview = null
  return drop
}

/** Rows as their ancestors make them, with one ancestor query per 90 rows. */
async function resolveRows(rows: (typeof drops.$inferSelect)[], days: number) {
  const ancestors = await ancestorsOf(rows)
  return rows.map((row) => resolveNode(row, ancestors.get(row.id) ?? [], days))
}

/**
 * Listed rows as summaries: app paths for the owner's apps, how many drops each folder holds, image thumbnails, with
 * `path` the folders each one sits in, up to (not including) `below`, and a search's snippets.
 */
async function summarize(
  rows: DropRow[],
  days: number,
  options: { ownerId?: string; path?: boolean; below?: string; snippets?: Map<string, string | undefined> } = {},
) {
  // By owner, not by a list of app ids: D1 binds at most 100 parameters per query.
  const files =
    options.ownerId && rows.some((row) => row.kind === "app")
      ? await db
          .select({ dropId: dropFiles.dropId, path: dropFiles.path })
          .from(dropFiles)
          .innerJoin(dropHeads, eq(dropHeads.dropId, dropFiles.dropId))
          .where(eq(dropHeads.ownerId, options.ownerId))
      : []
  const pathsOf = (id: string) =>
    files
      .filter((file) => file.dropId === id)
      .map((file) => file.path)
      .sort()
  const counts = await itemCounts(rows.flatMap((row) => (row.kind === "folder" ? [row.id] : [])))
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

const heads = (where: SQL | undefined, limit: number) =>
  db
    .select({ drop: drops })
    .from(dropHeads)
    .innerJoin(drops, eq(drops.id, dropHeads.dropId))
    .where(where)
    .orderBy(desc(dropHeads.updatedAt))
    .limit(limit)
    .then((rows) => rows.map((row) => row.drop))

/** Latest versions in `where`, or with words the ones matching them (name or text), and each match's snippet. */
async function headsMatching(where: SQL | undefined, words: string[], limit: number) {
  if (!words.length) return { rows: await heads(where, limit), snippets: undefined }
  const found = await searchHeads(where, words, limit)
  return { rows: found.map((item) => item.drop), snippets: new Map(found.map((item) => [item.drop.id, item.snippet])) }
}

const idOf = (where: SQL) => db.select({ id: drops.id }).from(drops).where(where).limit(1)
const headOf = (link: string) =>
  db
    .select({ id: drops.id })
    .from(drops)
    .innerJoin(dropHeads, eq(dropHeads.dropId, drops.id))
    .where(eq(drops.link, link))
    .limit(1)

/** A drop by its id, or by its share link's key: the doc's latest version. The id wins, in the same query. */
export function findDrop(id: string, event?: H3Event) {
  return findOne(sql`coalesce(${idOf(eq(drops.id, id))}, ${headOf(id)})`, event)
}

/** A drop an agent names: its id, its link's key, or its share link (`…/d/<key>/<slug>?v=2` pins a version). */
export async function findDropByRef(ref: string, event?: H3Event) {
  const link = ref.trim().match(/\/d\/([^/?#]+)[^?#]*(?:\?(?:[^#]*&)?v=(\d+))?/)
  if (!link) return findDrop(ref.trim(), event)
  return link[2] ? findDropByLink(link[1]!, Number(link[2]), event) : findDrop(link[1]!, event)
}

/** The version of the doc behind a share link, or its latest one. */
export function findDropByLink(link: string, version?: number, event?: H3Event) {
  return findOne(
    version ? sql`${idOf(and(eq(drops.link, link), eq(drops.version, version))!)}` : sql`${headOf(link)}`,
    event,
  )
}

export function findDropByBlob(key: string, event?: H3Event) {
  return findOne(sql`${idOf(eq(drops.blobKey, key))}`, event)
}

/** Drops of these kinds, or of any kind when there are none. */
const ofKinds = (kinds?: DropKind[]) => (kinds?.length ? inArray(drops.kind, kinds) : undefined)

/**
 * Your drops, newest first: the ones at the top (folders hold the rest), the ones in your Trash, or with `query` the
 * matches at any depth; `kinds` keeps those kinds only, at any depth too. Older versions of a doc hide behind their
 * latest, and files a doc embeds hide behind the doc. A folder in the Trash takes its drops along, so only the top-most
 * node in the Trash lists.
 */
export async function listDrops(
  who: Identity,
  event?: H3Event,
  options: { trash?: boolean; query?: string; kinds?: DropKind[]; limit?: number } = {},
): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const deep = words.length > 0 || Boolean(options.kinds?.length)
  // The team's folders list for everyone (listSharedWithMe), not as their creator's.
  const scope = options.trash
    ? and(listedNode, or(isNull(drops.parentId), isNotNull(drops.trashedAt)))
    : deep
      ? and(listedNode, ofKinds(options.kinds))
      : and(isNull(drops.parentId), eq(drops.teamFolder, false))
  const found = await headsMatching(and(eq(dropHeads.ownerId, who.userId), scope), words, options.limit ?? 500)
  const rows = await resolveRows(found.rows, days)
  const listed = rows.filter((row) => (options.trash ? row.expired && !parentNode(row, days)?.expired : !row.expired))
  return summarize(listed, days, { ownerId: who.userId, path: deep, snippets: found.snippets })
}

/**
 * A folder's drops, newest first: the ones directly inside, or with `query` or `kinds` the matches anywhere below it. Drops someone
 * moved to the Trash on their own list there instead. Anyone who may open the folder may open what it holds. A team
 * folder holds everyone's drops; any other folder only its owner's.
 */
export async function listFolder(
  folder: DropRow,
  event?: H3Event,
  options: { query?: string; kinds?: DropKind[]; who?: Identity | null } = {},
): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const deep = words.length > 0 || Boolean(options.kinds?.length)
  const inside = deep ? inArray(drops.parentId, foldersUnder(folder.id)) : eq(drops.parentId, folder.id)
  const owned = folder.teamFolder ? undefined : eq(dropHeads.ownerId, folder.ownerId)
  const found = await headsMatching(
    and(owned, inside, ofKinds(options.kinds), isNull(drops.trashedAt)),
    words,
    deep ? 200 : 500,
  )
  // Its direct drops take the folder's own ancestors; matches deeper down look theirs up.
  const above = [folder.raw ?? folder, ...(folder.ancestors ?? [])]
  const rows = deep ? await resolveRows(found.rows, days) : found.rows.map((row) => resolveNode(row, above, days))
  // The owner may open a folder in the Trash, and sees what it holds as it was.
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
  // A team folder holds everyone's drops: each says whose it is, unless it's the reader's own.
  const ownerIds = [...new Set(listed.map((row) => row.ownerId).filter((id) => id !== options.who?.userId))]
  const owners = new Map<string, { name: string; image: string | null }>()
  for (let offset = 0; offset < ownerIds.length; offset += 90)
    for (const row of await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(inArray(user.id, ownerIds.slice(offset, offset + 90))))
      owners.set(row.id, { name: row.name, image: row.image })
  const ownerOf = new Map(listed.map((row) => [row.id, row.ownerId]))
  return summaries.map((summary) => {
    const owner = owners.get(ownerOf.get(summary.id)!)
    return owner && !summary.teamFolder ? { ...summary, owner } : summary
  })
}

/**
 * Every folder a drop of yours may go in, for picking where it goes: your own and the team's. Folders in the Trash stay
 * out. Each carries its description (`note`), which agents read to choose one.
 */
export async function listFolders(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const mine = and(eq(dropHeads.ownerId, who.userId), eq(drops.teamFolder, false))
  const rows = await resolveRows(
    await heads(and(eq(drops.kind, "folder"), or(mine, teamFolderSql(`"drops"`, who, event))), 500),
    days,
  )
  return summarize(
    rows.filter((row) => !row.expired && !row.quarantinedAt),
    days,
    { path: true },
  )
}

/**
 * SQL for a team folder, at table alias `node`, on the caller's team: every one on a team Drop, and on a personal Drop
 * the ones of the teams they're on.
 */
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

/**
 * SQL for a drop, at table alias `node`, that reaches someone besides its owner: on a team Drop anything not kept
 * private; on a personal one a public link that's open and approved, which they opened while signed in.
 */
function reachableSql(node: string, who: Identity, now: number, event?: H3Event) {
  const at = sql.raw(node)
  if (sharePolicy(event).mode === "team") return sql`(${at}.share != 'private')`
  return sql`(${at}.share IN ('public', 'public_comment') AND ${at}.share_review IS NULL AND (${at}.public_until IS NULL OR ${at}.public_until > ${now})
    AND EXISTS (SELECT 1 FROM drop_visits v WHERE v.user_id = ${who.userId} AND v.drop_id = ${at}.id))`
}

/**
 * What others share with you. On a team Drop: the team's folders, then everyone else's drops shared with the team. On a
 * personal Drop: public links you opened while signed in. Newest first; drops in the Trash, quarantined, or from banned
 * owners stay out. A folder shared with you lists once: the drops inside open from it.
 */
export async function listSharedWithMe(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const now = Date.now()
  const others = and(ne(drops.ownerId, who.userId), reachableSql(`"drops"`, who, now, event))
  const rows = await db
    .select({ drop: drops, ownerName: user.name, ownerImage: user.image })
    .from(drops)
    .innerJoin(dropHeads, eq(dropHeads.dropId, drops.id))
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

/**
 * Other people's drops you can open that match a search: what Shared with me lists, and everything inside the folders
 * it lists, at any depth. The same rules hold: nothing waiting for review, quarantined, in the Trash, or from a banned
 * owner, and admins find no one's private drops here. A path shows only the folders you may open.
 */
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
  // Folders that open to you, yours aside, and the team's, whoever made them: what's in them opens through them.
  const openFolders = sql`(
    WITH RECURSIVE open(id, depth) AS (
      SELECT d.id, 0 FROM drops d WHERE d.kind = 'folder' AND ((d.owner_id != ${who.userId} AND ${reachable("d")}) OR ${teamFolderSql("d", who, event)})
        AND d.trashed_at IS NULL AND d.quarantined_at IS NULL
      UNION ALL SELECT d.id, open.depth + 1 FROM drops d JOIN open ON d.parent_id = open.id WHERE d.kind = 'folder' AND open.depth < ${MAX_DEPTH}
    ) SELECT id FROM open
  )`
  const found = await searchHeads(
    and(
      ne(dropHeads.ownerId, who.userId),
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
  // Review, quarantine and the Trash anywhere above hold a drop too: resolving its path says.
  const nodes = (
    await resolveRows(
      found.map((item) => item.drop),
      days,
    )
  ).filter((node) => !node.expired && !node.quarantinedAt && permissions(node, who).view)
  const ownerIds = [...new Set(nodes.map((node) => node.ownerId))]
  const owners = new Map<string, { name: string; image: string | null }>()
  for (let offset = 0; offset < ownerIds.length; offset += 90)
    for (const row of await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(inArray(user.id, ownerIds.slice(offset, offset + 90))))
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

/**
 * Everything you can open that matches a search, for the search palette: your drops at any depth first, then other
 * people's (see `searchShared`). Each list keeps its newest `limit`. `kinds` keeps those kinds only, and searches with
 * no words too.
 */
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

/** Remembers a public drop a signed-in person opened, at most once a day per drop. */
export async function recordSharedVisit(drop: DropRow, who: Identity | null) {
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
    log.error({ action: "drop-shared-visit", error: String(error) })
  }
}

export function storageFailure(error: Error) {
  log.error({
    action: "storage",
    error: error.message,
    cause: error.cause instanceof Error ? error.cause.message : error.cause,
  })
  return new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable.", cause: error })
}

async function readFile(key: string) {
  const [error, file] = await blob.get(key)
  if (error && error.code !== "BLOB_NOT_FOUND") throw storageFailure(error)
  if (!file) throw new HTTPError({ status: 404, statusText: "File content is missing." })
  return file
}

export const readText = async (key: string) => (await readFile(key)).text()

const readBytes = async (key: string) => new Uint8Array(await (await readFile(key)).arrayBuffer())

export async function versionChain(row: DropRow) {
  // Follow indexed parent/child links, retaining the existing 50 older / 100 total view bounds.
  const docs = await db
    .select()
    .from(drops)
    .where(
      inArray(
        drops.id,
        sql`(
    WITH RECURSIVE
    older(id, supersedes_id, depth) AS (
      SELECT id, supersedes_id, 0 FROM drops WHERE id = ${row.id} AND owner_id = ${row.ownerId}
      UNION ALL
      SELECT d.id, d.supersedes_id, o.depth + 1 FROM drops d JOIN older o ON d.id = o.supersedes_id
      WHERE d.owner_id = ${row.ownerId} AND o.depth < 49
    ),
    newer(id, depth) AS (
      SELECT id, 0 FROM drops WHERE id = ${row.id} AND owner_id = ${row.ownerId}
      UNION ALL
      SELECT d.id, n.depth + 1 FROM drops d JOIN newer n ON d.supersedes_id = n.id
      WHERE d.owner_id = ${row.ownerId} AND n.depth < 99
    )
    SELECT id FROM older UNION SELECT id FROM newer
  )
  `,
      ),
    )
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const next = new Map(docs.filter((doc) => doc.supersedesId).map((doc) => [doc.supersedesId!, doc]))
  const chain = [byId.get(row.id) ?? row]
  for (
    let older = chain[0]!.supersedesId;
    older && byId.has(older) && chain.length < 50;
    older = byId.get(older)!.supersedesId
  )
    chain.push(byId.get(older)!)
  for (let newer = next.get(row.id); newer && chain.length < 100; newer = next.get(newer.id)) chain.unshift(newer)
  return chain
}

/**
 * Whether someone may open this drop in the live editor: a person in the browser (never an agent) who may edit the
 * current version of a Markdown drop, on a host with Realtime rooms. Older versions stay read-only so a draft always
 * continues the latest text.
 */
export function liveEditable(row: DropRow, who: Identity | null, versions: DropVersion[]) {
  return (
    LIVE_EDITING &&
    who?.actorKind === "browser" &&
    permissions(row, who).edit &&
    row.kind === "markdown" &&
    versions[0]?.id === row.id
  )
}

/** The version chain, newest first. */
export async function versionsOf(row: DropRow): Promise<DropVersion[]> {
  return (await versionChain(row)).map((item) => ({
    id: item.id,
    title: item.title,
    version: item.version,
    createdAt: item.createdAt,
    note: item.note,
    actorName: item.actorName,
    current: item.id === row.id,
  }))
}

/**
 * What an app's detail reads of its files: `all` its text files, for the viewer to build pages from; `pages` only its
 * HTML, when its origin serves the rest; `agent` the smaller text files, for read_drop, and only sizes for the rest.
 */
type AppText = "all" | "pages" | "agent"
// read_drop's share of a built app: enough to see what it is without pasting a bundle into an agent's context.
const AGENT_FILE_BYTES = 64 * 1024
const AGENT_FILES = 40

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
  // No part waits for another, so their queries reach the database together instead of one round trip each.
  const [versions, body, attachments, views, resources] = await Promise.all([
    versionsOf(row),
    bodyOf(row, who, origin, event, appText),
    TEXT_KINDS.has(row.kind) ? attachmentsOf(row, origin) : undefined,
    can.manage && !isAttachment(row) ? viewsOf(row) : undefined,
    // Everyone who can open it sees what it links to.
    isAttachment(row) ? [] : resourcesOf(row),
  ])
  const detail: DropDetail = {
    ...toSummary(row, undefined, days),
    isOwner: can.manage,
    canTrash: can.trash,
    canComment: can.comment,
    canEdit: liveEditable(row, who, versions),
    versions,
    ancestors: openableAncestors(row, who, days),
    ...body,
  }
  if (detail.canEdit && row.kind === "markdown" && hasEditorlessSyntax(detail.content ?? "")) {
    detail.canEdit = false
    detail.editNote = "This doc uses Comark components or footnotes, which the editor can't keep yet."
  }
  if (attachments) detail.attachments = attachments
  if (row.kind === "site" && row.siteUrl) detail.siteUrl = row.siteUrl
  if (views) detail.views = views
  if (resources.length) detail.resources = resources
  return detail
}

/** What a drop holds: a folder's drops, an app's files, a doc's text and rendering, and the excerpt read from them. */
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
    const read = files
      .filter((file) =>
        appText === "pages"
          ? /\.html?$/i.test(file.path)
          : isTextFile(file.path) && (appText === "all" || file.size <= AGENT_FILE_BYTES),
      )
      .slice(0, appText === "agent" ? AGENT_FILES : undefined)
    detail.files = Object.fromEntries(
      await Promise.all(read.map(async (file) => [file.path, await readText(file.blobKey)] as const)),
    )
    detail.paths = files.map((file) => file.path).sort()
    detail.sizes = Object.fromEntries(files.map((file) => [file.path, file.size]))
  } else if (row.blobKey) {
    if (row.kind === "markdown") {
      const rendered = await renderMarkdownCached(row.blobKey, () => readText(row.blobKey!), event)
      detail.content = rendered.source
      detail.html = rendered.html
    } else if (TEXT_KINDS.has(row.kind)) detail.content = await readText(row.blobKey)
    else if (row.kind === "file" && SPREADSHEET_EXTENSIONS.has(spreadsheetExtension(row.filename))) {
      // Read-only: what each cell shows, rendered once per blob like a Markdown doc.
      const key = row.blobKey
      detail.html = await renderSpreadsheetCached(key, spreadsheetExtension(row.filename), () => readBytes(key), event)
    }
    detail.url = new URL(`/f/${row.blobKey}?raw`, origin).href
  }
  detail.excerpt = await dropExcerpt(row, detail.content)
  return detail
}

/**
 * The nodes above a drop that the caller may open, top-most first. A share widens going down, so the ones the caller
 * can't open are always the top-most: someone sent one drop from a private folder sees no folder names.
 */
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

/** Images sent in comments (server/utils/comment-images.ts) are the doc's children too, but it doesn't embed them. */
const notCommentImage = sql`NOT EXISTS (SELECT 1 FROM comment_attachments WHERE comment_attachments.drop_id = ${drops.id})`

/** Files a doc embeds from this Drop, across every version of the doc. */
async function attachmentsOf(row: DropRow, origin: string): Promise<DropAttachment[]> {
  const rows = await db
    .select()
    .from(drops)
    .where(and(sql`${drops.parentId} IN (${chainOf(row)})`, isNotNull(drops.blobKey), notCommentImage))
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
