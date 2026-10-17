import { and, desc, eq, exists, inArray, isNotNull, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm"
import { log } from "evlog"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { blobCleanup, dropFiles, dropHeads, drops, dropVisits, user } from "../databases/config"
import { dropPath, newLink, slugify } from "#shared/links"
import { kindFromFilename, titleFromSource } from "#shared/plans"
import { renderMarkdownCached } from "./markdown-document"
import { deleteMarkdownCache } from "./markdown-cache"
import { appLinkIssues, contentTypeOf } from "#shared/project-bundle"
import { ACCESS_RANK, type Access, type DropAttachment, type DropCrumb, type DropDetail, type DropSummary, type DropVersion, type Visibility } from "#shared/types"
import { DAY_MS, expiresAt, type Lifetime, MAX_KEEP_REASON, TEMPORARY_DAYS, TRASH_DAYS } from "#shared/expiry"
import { shareReviewFor } from "./trust"
import type { Identity } from "./identity"
import { withDropQuota } from "./quotas"
import { LIVE_EDITING } from "#live-drafts"
import { draftPath } from "./draft-paths"
import { deleteRetainedDrop } from "./quota-deletion"
import { chainOf, expiryPolicy, renewDrop } from "./expiry"
import { ancestorsOf, foldersUnder, type Grant, isAttachment, itemCounts, listedNode, parentNode, resolveNode, touchFolder, uniqueSlug } from "./nodes"
import { searchHeads, searchWords, textStatements } from "./search"

/**
 * `expired` means gone for its links: in the Trash, or past its window and waiting for the hourly move there. Rows
 * found through `findDrop` and the lists carry what their ancestors give them (see ./nodes): `raw` is the row as stored,
 * `ancestors` the nodes above it, nearest first, and `grants` every share on the way.
 */
export type DropRow = typeof drops.$inferSelect & {
  ownerBanned?: boolean
  expired?: boolean
  raw?: typeof drops.$inferSelect
  ancestors?: (typeof drops.$inferSelect)[]
  grants?: Grant[]
  sharedFrom?: { id: string; title: string }
}

import { MAX_FILE_BYTES } from "#shared/schemas"
import { MAX_DEPTH } from "#shared/nodes"
import { hasBlockComponents, splitFrontmatter } from "#shared/frontmatter"
import { MAX_APP_FILES } from "#shared/quotas"

export { MAX_FILE_BYTES }
const TEXT_KINDS = new Set(["markdown", "html"])

/**
 * What the caller may do with a drop. Editors and admins act on every drop in the workspace. A share reaches the team
 * (everyone signed in to this Drop, and their agents) or anyone with the link, and lets them view, comment, or edit; "Can
 * edit" lets signed-in people edit in the browser, not their agents, so only the owner and staff publish through agents.
 * An expired drop is read-only for the people who can renew it and gone for everyone else. A drop in a folder counts
 * every share on its path, and the widest one that reaches the caller sets the level.
 */
export function permissions(drop: DropRow, who: Identity | null) {
  if (drop.quarantinedAt) return { owner: false, view: false, comment: false, edit: false, manage: Boolean(who && (who.userId === drop.ownerId || who.role === "admin")) }
  const owner = Boolean(who && who.userId === drop.ownerId)
  const staff = Boolean(who && (who.role === "admin" || who.role === "editor"))
  const reaching = (drop.grants ?? [drop]).filter(grant => reachesGrant(grant, who))
  const shared = reaching.length > 0 && !drop.shareReview && !drop.expired
  const level = Math.max(-1, ...reaching.map(grant => ACCESS_RANK[grant.access as Access]))
  const available = !drop.ownerBanned
  const live = available && !drop.expired
  return {
    owner,
    view: available && (owner || staff || shared),
    comment: live && (owner || staff || (shared && level >= ACCESS_RANK.comment)),
    edit: live && (owner || staff || (shared && level >= ACCESS_RANK.edit && who?.actorKind === "browser")),
    manage: owner || staff,
  }
}

const reachesGrant = (grant: Pick<Grant, "visibility">, who: Identity | null) =>
  grant.visibility === "shared" || (grant.visibility === "team" && who !== null)

/** Whether a share on the drop's path includes the caller, review and expiry aside. Team shares need a signed-in caller. */
export const reaches = (drop: Pick<DropRow, "visibility" | "grants">, who: Identity | null) =>
  (drop.grants ?? [drop]).some(grant => reachesGrant(grant, who))

/** A share that worked until its drop expired. Private drops stay indistinguishable from missing ones. */
export const expiredLink = (drop: DropRow | null, who: Identity | null) =>
  Boolean(drop?.expired && reaches(drop, who) && !drop.shareReview && !drop.ownerBanned && !drop.quarantinedAt && !permissions(drop, who).view)

/** A share the caller would see once an admin approves it. Anyone else gets the usual 404. */
export const waitingForReview = (drop: DropRow | null, who: Identity | null) =>
  Boolean(drop && !drop.ownerBanned && !drop.quarantinedAt && reaches(drop, who) && drop.shareReview === "pending" && !permissions(drop, who).view)

export function toSummary(row: DropRow, paths?: string[], days = expiryPolicy().days): DropSummary {
  const expires = expiresAt(row, days)
  return {
    id: row.id, link: row.link ?? row.id, slug: row.slug ?? slugify(row.title), kind: row.kind, title: row.title, filename: row.filename, size: row.size, version: row.version,
    shareReview: row.shareReview, quarantinedAt: row.quarantinedAt, visibility: row.visibility, access: row.access as Access, actorKind: row.actorKind, actorName: row.actorName,
    createdAt: row.createdAt, updatedAt: row.updatedAt, ...(paths ? { paths } : {}),
    expiresAt: expires, lifetime: row.lifetime, keepReason: row.keepReason, note: row.note, parentId: row.parentId,
    // Past its window but not yet moved by the hourly cleanup: it's in the Trash already, as of when it expired.
    trashedAt: row.trashedAt ?? (row.expired && expires !== null ? expires : null),
    trashReason: row.trashReason ?? (row.expired ? "expired" : null),
    ...(row.sharedFrom && row.raw ? { sharedFrom: row.sharedFrom, ownShare: { visibility: row.raw.visibility, access: row.raw.access as Access } } : {}),
  }
}

/** A node as a breadcrumb. */
export const toCrumb = (row: typeof drops.$inferSelect): DropCrumb =>
  ({ id: row.id, kind: row.kind, title: row.title, link: row.link ?? row.id, slug: row.slug ?? slugify(row.title) })

/**
 * Reuse the joined owner for review policy so each lookup remains one query, plus one for the ancestors of a drop in a
 * folder or a file a doc embeds: it is shared, kept, and trashed with them (see ./nodes).
 */
async function withOwnerAccess(row: { drop: typeof drops.$inferSelect; owner: typeof user.$inferSelect | null } | undefined, event?: H3Event): Promise<DropRow | null> {
  if (!row) return null
  const ancestors = row.drop.parentId ? (await ancestorsOf([row.drop])).get(row.drop.id)! : []
  const drop: DropRow = { ...resolveNode(row.drop, ancestors, expiryPolicy(event).days), ownerBanned: !row.owner || Boolean(row.owner.banned) }
  if (event && drop.shareReview && await shareReviewFor(drop.ownerId, event, row.owner) === null) drop.shareReview = null
  return drop
}

/** Rows as their ancestors make them, with one ancestor query per 90 rows. */
async function resolveRows(rows: (typeof drops.$inferSelect)[], days: number) {
  const ancestors = await ancestorsOf(rows)
  return rows.map(row => resolveNode(row, ancestors.get(row.id) ?? [], days))
}

/**
 * Listed rows as summaries: app paths for the owner's apps, how many drops each folder holds, image thumbnails, with
 * `path` the folders each one sits in, up to (not including) `below`, and a search's snippets.
 */
async function summarize(rows: DropRow[], days: number, options: { ownerId?: string; path?: boolean; below?: string; snippets?: Map<string, string | undefined> } = {}) {
  // By owner, not by a list of app ids: D1 binds at most 100 parameters per query.
  const files = options.ownerId && rows.some(row => row.kind === "app")
    ? await db.select({ dropId: dropFiles.dropId, path: dropFiles.path }).from(dropFiles).innerJoin(dropHeads, eq(dropHeads.dropId, dropFiles.dropId)).where(eq(dropHeads.ownerId, options.ownerId))
    : []
  const pathsOf = (id: string) => files.filter(file => file.dropId === id).map(file => file.path).sort()
  const counts = await itemCounts(rows.filter(row => row.kind === "folder").map(row => row.id))
  const pathOf = (row: DropRow) => {
    const above = row.ancestors ?? []
    const stop = options.below ? above.findIndex(node => node.id === options.below) : -1
    return (stop === -1 ? above : above.slice(0, stop)).map(toCrumb).reverse()
  }
  return rows.map(row => ({
    ...toSummary(row, row.kind === "app" ? pathsOf(row.id) : undefined, days),
    ...(row.kind === "folder" ? { items: counts.get(row.id) ?? 0 } : {}),
    ...(row.kind === "image" && row.blobKey ? { thumbnail: `/f/${row.blobKey}` } : {}),
    ...(options.path ? { path: pathOf(row) } : {}),
    ...(options.snippets?.get(row.id) ? { snippet: options.snippets.get(row.id) } : {}),
  }))
}

const heads = (where: SQL | undefined, limit: number) => db.select({ drop: drops }).from(dropHeads).innerJoin(drops, eq(drops.id, dropHeads.dropId))
  .where(where).orderBy(desc(dropHeads.updatedAt)).limit(limit).then(rows => rows.map(row => row.drop))

/** Latest versions in `where`, or with words the ones matching them (name or text), and each match's snippet. */
async function headsMatching(where: SQL | undefined, words: string[], limit: number) {
  if (!words.length) return { rows: await heads(where, limit), snippets: undefined }
  const found = await searchHeads(where, words, limit)
  return { rows: found.map(item => item.drop), snippets: new Map(found.map(item => [item.drop.id, item.snippet])) }
}

/** A drop by its id, or by its share link's key: the doc's latest version. */
export async function findDrop(id: string, event?: H3Event) {
  const [row] = await db.select({ drop: drops, owner: user }).from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId)).where(eq(drops.id, id)).limit(1)
  return row ? withOwnerAccess(row, event) : findDropByLink(id, undefined, event)
}

/** A drop an agent names: its id, its link's key, or its share link (`…/d/<key>/<slug>?v=2` pins a version). */
export async function findDropByRef(ref: string, event?: H3Event) {
  const link = ref.trim().match(/\/d\/([^/?#]+)[^?#]*(?:\?(?:[^#]*&)?v=(\d+))?/)
  if (!link) return findDrop(ref.trim(), event)
  return link[2] ? findDropByLink(link[1]!, Number(link[2]), event) : findDrop(link[1]!, event)
}

/** The version of the doc behind a share link, or its latest one. */
export async function findDropByLink(link: string, version?: number, event?: H3Event) {
  const query = db.select({ drop: drops, owner: user }).from(drops).leftJoin(user, eq(user.id, drops.ownerId))
  const [row] = version
    ? await query.where(and(eq(drops.link, link), eq(drops.version, version))).limit(1)
    : await query.innerJoin(dropHeads, eq(dropHeads.dropId, drops.id)).where(eq(drops.link, link)).limit(1)
  return withOwnerAccess(row, event)
}

export async function findDropByBlob(key: string, event?: H3Event) {
  const [row] = await db.select({ drop: drops, owner: user }).from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId)).where(eq(drops.blobKey, key)).limit(1)
  return withOwnerAccess(row, event)
}

/**
 * Your drops, newest first: the ones at the top (folders hold the rest), the ones in your Trash, or with `query` the
 * matches at any depth. Older versions of a doc hide behind their latest, and files a doc embeds hide behind the doc.
 * A folder in the Trash takes its drops along, so only the top-most node in the Trash lists.
 */
export async function listDrops(who: Identity, event?: H3Event, options: { trash?: boolean; query?: string; limit?: number } = {}): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const scope = options.trash ? and(listedNode, or(isNull(drops.parentId), isNotNull(drops.trashedAt))) : words.length ? listedNode : isNull(drops.parentId)
  const found = await headsMatching(and(eq(dropHeads.ownerId, who.userId), scope), words, options.limit ?? 500)
  const rows = await resolveRows(found.rows, days)
  const listed = rows.filter(row => (options.trash ? row.expired && !parentNode(row, days)?.expired : !row.expired))
  return summarize(listed, days, { ownerId: who.userId, path: words.length > 0, snippets: found.snippets })
}

/**
 * A folder's drops, newest first: the ones directly inside, or with `query` the matches anywhere below it. Drops someone
 * moved to the Trash on their own list there instead. Anyone who may open the folder may open what it holds.
 */
export async function listFolder(folder: DropRow, event?: H3Event, options: { query?: string } = {}): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const words = searchWords(options.query)
  const inside = words.length ? inArray(drops.parentId, foldersUnder(folder.id)) : eq(drops.parentId, folder.id)
  const found = await headsMatching(and(eq(dropHeads.ownerId, folder.ownerId), inside, isNull(drops.trashedAt)), words, words.length ? 200 : 500)
  // Its direct drops take the folder's own ancestors; matches deeper down look theirs up.
  const above = [folder.raw ?? folder, ...(folder.ancestors ?? [])]
  const rows = words.length ? await resolveRows(found.rows, days) : found.rows.map(row => resolveNode(row, above, days))
  // The owner may open a folder in the Trash, and sees what it holds as it was.
  const listed = rows.filter(row => folder.expired || !row.expired).map(row => ({ ...row, ownerBanned: folder.ownerBanned }))
  return summarize(listed, days, { ownerId: folder.ownerId, path: words.length > 0, below: folder.id, snippets: found.snippets })
}

/** Every folder you have, for picking where a drop goes. Folders in the Trash stay out. */
export async function listFolders(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const { days } = expiryPolicy(event)
  const rows = await resolveRows(await heads(and(eq(dropHeads.ownerId, who.userId), eq(drops.kind, "folder")), 500), days)
  return summarize(rows.filter(row => !row.expired), days, { path: true })
}

/**
 * Other people's drops you can open: everything shared with the team, plus links you opened while signed in. Newest
 * first; drops waiting for review, in the Trash, or from banned owners stay out. A folder shared with you lists once:
 * the drops inside open from it.
 */
export async function listSharedWithMe(who: Identity, event?: H3Event): Promise<DropSummary[]> {
  const visited = exists(db.select({ at: dropVisits.at }).from(dropVisits).where(and(eq(dropVisits.userId, who.userId), eq(dropVisits.dropId, drops.id))))
  const rows = await db.select({ drop: drops, ownerName: user.name, ownerImage: user.image }).from(drops)
    .innerJoin(dropHeads, eq(dropHeads.dropId, drops.id)).innerJoin(user, eq(user.id, drops.ownerId))
    .where(and(
      or(eq(drops.visibility, "team"), and(eq(drops.visibility, "shared"), visited)),
      ne(drops.ownerId, who.userId), listedNode, isNull(drops.trashedAt), isNull(drops.quarantinedAt), isNull(drops.shareReview),
      sql`coalesce(${user.banned}, 0) = 0`,
    )).orderBy(desc(drops.updatedAt)).limit(200)
  const { days } = expiryPolicy(event)
  const ancestors = await ancestorsOf(rows.map(row => row.drop))
  const listed = new Set(rows.map(row => row.drop.id))
  const owners = new Map(rows.map(row => [row.drop.id, { name: row.ownerName, image: row.ownerImage }]))
  const nodes = rows.map(row => resolveNode(row.drop, ancestors.get(row.drop.id) ?? [], days))
    .filter(node => !node.expired && !node.quarantinedAt && !node.shareReview
      && !node.ancestors!.some(above => listed.has(above.id) || (above.visibility === "team" && !above.shareReview)))
  return (await summarize(nodes, days)).map(summary => ({ ...summary, owner: owners.get(summary.id)! }))
}

/**
 * Other people's drops you can open that match a search: what Shared with me lists, and everything inside the folders
 * it lists, at any depth. The same rules hold: nothing waiting for review, quarantined, in the Trash, or from a banned
 * owner, and staff find no one's private drops here. A path shows only the folders you may open.
 */
async function searchShared(who: Identity, words: string[], limit: number, event?: H3Event): Promise<DropSummary[]> {
  // Shared with the team, or by link and opened by you. `node` is a table alias in the query.
  const reachable = (node: string) => sql`(${sql.raw(node)}.visibility = 'team' OR (${sql.raw(node)}.visibility = 'shared'
    AND EXISTS (SELECT 1 FROM drop_visits v WHERE v.user_id = ${who.userId} AND v.drop_id = ${sql.raw(node)}.id)))`
  const openFolders = sql`(
    WITH RECURSIVE open(id, depth) AS (
      SELECT d.id, 0 FROM drops d WHERE d.kind = 'folder' AND d.owner_id != ${who.userId} AND ${reachable("d")}
        AND d.trashed_at IS NULL AND d.quarantined_at IS NULL AND d.share_review IS NULL
      UNION ALL SELECT d.id, open.depth + 1 FROM drops d JOIN open ON d.parent_id = open.id WHERE d.kind = 'folder' AND open.depth < ${MAX_DEPTH}
    ) SELECT id FROM open
  )`
  const found = await searchHeads(and(
    ne(dropHeads.ownerId, who.userId), listedNode, isNull(drops.trashedAt), isNull(drops.quarantinedAt), isNull(drops.shareReview),
    or(reachable(`"drops"`), inArray(drops.parentId, openFolders)),
    sql`EXISTS (SELECT 1 FROM user u WHERE u.id = ${drops.ownerId} AND coalesce(u.banned, 0) = 0)`,
  ), words, limit)
  const { days } = expiryPolicy(event)
  // Review, quarantine and the Trash anywhere above hold a drop too: resolving its path says.
  const nodes = (await resolveRows(found.map(item => item.drop), days)).filter(node => !node.expired && !node.quarantinedAt && !node.shareReview)
  const ownerIds = [...new Set(nodes.map(node => node.ownerId))]
  const owners = new Map<string, { name: string; image: string | null }>()
  for (let offset = 0; offset < ownerIds.length; offset += 90)
    for (const row of await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, ownerIds.slice(offset, offset + 90))))
      owners.set(row.id, { name: row.name, image: row.image })
  const byId = new Map(nodes.map(node => [node.id, node]))
  const summaries = await summarize(nodes, days, { snippets: new Map(found.map(item => [item.drop.id, item.snippet])) })
  return summaries.map(summary => ({ ...summary, path: openableAncestors(byId.get(summary.id)!, who, days), owner: owners.get(byId.get(summary.id)!.ownerId)! }))
}

/**
 * Everything you can open that matches a search, for the search palette: your drops at any depth first, then other
 * people's (see `searchShared`). Each list keeps its newest `limit`.
 */
export async function searchEverything(who: Identity, query: string, event?: H3Event, limit = 30): Promise<DropSummary[]> {
  const words = searchWords(query)
  if (!words.length) return []
  return [...await listDrops(who, event, { query, limit }), ...await searchShared(who, words, limit, event)]
}

/** Remembers a link-shared drop a signed-in person opened, at most once a day per drop. */
export async function recordSharedVisit(drop: DropRow, who: Identity | null) {
  if (!who || who.actorKind !== "browser" || who.userId === drop.ownerId || drop.visibility !== "shared" || isAttachment(drop)) return
  const at = Date.now()
  try {
    await db.insert(dropVisits).values({ userId: who.userId, dropId: drop.id, at })
      .onConflictDoUpdate({ target: [dropVisits.userId, dropVisits.dropId], set: { at }, setWhere: lte(dropVisits.at, at - DAY_MS) })
  }
  catch (error) {
    log.error({ action: "drop-shared-visit", error: String(error) })
  }
}

function storageFailure(error: Error) {
  log.error({ action: "storage", error: error.message, cause: String((error as { cause?: unknown }).cause ?? "") })
  return new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable.", cause: error })
}

export async function readText(key: string) {
  const [error, file] = await blob.get(key)
  if (error?.code === "BLOB_NOT_FOUND") throw new HTTPError({ status: 404, statusText: "File content is missing." })
  if (error) throw storageFailure(error)
  if (!file) throw new HTTPError({ status: 404, statusText: "File content is missing." })
  return await file.text()
}

export async function versionChain(row: DropRow) {
  // Follow indexed parent/child links, retaining the existing 50 older / 100 total view bounds.
  const docs = await db.select().from(drops).where(inArray(drops.id, sql`(
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
  `))
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const next = new Map(docs.filter(doc => doc.supersedesId).map(doc => [doc.supersedesId!, doc]))
  const chain = [byId.get(row.id) ?? row]
  for (let older = chain[0]!.supersedesId; older && byId.has(older) && chain.length < 50; older = byId.get(older)!.supersedesId) chain.push(byId.get(older)!)
  for (let newer = next.get(row.id); newer && chain.length < 100; newer = next.get(newer.id)) chain.unshift(newer)
  return chain
}

/**
 * Whether someone may open this drop in the live editor: a person in the browser (never an agent) who may edit the
 * current version of a Markdown drop, on a host with Realtime rooms. Older versions stay read-only so a draft always
 * continues the latest text.
 */
export function liveEditable(row: DropRow, who: Identity | null, versions: DropVersion[]) {
  return LIVE_EDITING && who?.actorKind === "browser" && permissions(row, who).edit
    && row.kind === "markdown" && versions[0]?.id === row.id
}

/** The version chain, newest first. */
export async function versionsOf(row: DropRow): Promise<DropVersion[]> {
  return (await versionChain(row)).map(item => ({ id: item.id, title: item.title, version: item.version, createdAt: item.createdAt, note: item.note, actorName: item.actorName, current: item.id === row.id }))
}

export async function dropDetail(row: DropRow, who: Identity | null, origin: string, event?: H3Event): Promise<DropDetail> {
  const can = permissions(row, who)
  if (!can.view) throw new HTTPError({ status: 404, statusText: "Not found" })
  const { days } = expiryPolicy(event)
  const detail: DropDetail = {
    ...toSummary(row, undefined, days),
    isOwner: can.manage,
    canComment: can.comment,
    canEdit: false,
    versions: await versionsOf(row),
    ancestors: openableAncestors(row, who, days),
  }
  detail.canEdit = liveEditable(row, who, detail.versions)
  if (row.kind === "folder") {
    detail.children = await listFolder(row, event)
    detail.items = detail.children.length
  }
  if (row.kind === "app") {
    const files = await db.select().from(dropFiles).where(eq(dropFiles.dropId, row.id))
    detail.files = Object.fromEntries(await Promise.all(files.map(async file => [file.path, await readText(file.blobKey)] as const)))
    detail.paths = files.map(file => file.path).sort()
  }
  else if (row.blobKey) {
    if (row.kind === "markdown") {
      const rendered = await renderMarkdownCached(row.blobKey, () => readText(row.blobKey!), event)
      detail.content = rendered.source
      detail.html = rendered.html
      if (detail.canEdit && hasBlockComponents(rendered.source)) {
        detail.canEdit = false
        detail.editNote = "This doc uses Comark components, which the editor can't keep yet."
      }
    }
    else if (TEXT_KINDS.has(row.kind)) detail.content = await readText(row.blobKey)
    detail.url = new URL(`/f/${row.blobKey}?raw`, origin).href
  }
  if (TEXT_KINDS.has(row.kind)) detail.attachments = await attachmentsOf(row, origin)
  if (row.kind === "site" && row.siteUrl) detail.siteUrl = row.siteUrl
  return detail
}

/**
 * The nodes above a drop that the caller may open, top-most first. A share widens going down, so the ones the caller
 * can't open are always the top-most: someone sent one drop from a private folder sees no folder names.
 */
function openableAncestors(row: DropRow, who: Identity | null, days: number): DropCrumb[] {
  const above = row.ancestors ?? []
  return above.filter((node, index) => permissions({ ...resolveNode(node, above.slice(index + 1), days), ownerBanned: row.ownerBanned }, who).view)
    .map(toCrumb).reverse()
}

/** Files a doc embeds from this Drop, across every version of the doc. */
async function attachmentsOf(row: DropRow, origin: string): Promise<DropAttachment[]> {
  const rows = await db.select().from(drops).where(and(sql`${drops.parentId} IN (${chainOf(row)})`, isNotNull(drops.blobKey))).limit(100)
  return rows.map(item => ({ id: item.id, kind: item.kind, title: item.title, filename: item.filename, size: item.size, url: new URL(`/f/${item.blobKey}`, origin).href }))
}

/** `/f/<key>` links in a doc's source, absolute or relative, with or without `?raw`. */
const FILE_LINK = /\/f\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,16})/gi

/**
 * Makes the files a doc embeds its attachments, so they share its sharing, lifetime, and Trash. Only the doc owner's
 * own files that aren't docs themselves: embedding never exposes someone else's file. A file already attached to
 * another doc stays with that one, unless it's an older version of this doc.
 */
async function adoptAttachments(doc: DropRow, source: string, previous: DropRow | null) {
  // 90 keys and the other parameters stay under D1's 100 bound parameters per query.
  const keys = [...new Set([...source.matchAll(FILE_LINK)].map(match => match[1]!))].slice(0, 90)
  if (!keys.length) return
  const chain = previous ? (await versionChain(previous)).map(item => item.id) : []
  const owned = await db.select({ id: drops.id, parentId: drops.parentId }).from(drops)
    .where(and(inArray(drops.blobKey, keys), eq(drops.ownerId, doc.ownerId), inArray(drops.kind, ["image", "file"])))
  const ids = owned.filter(item => !item.parentId || chain.includes(item.parentId)).map(item => item.id)
  if (ids.length) await db.update(drops).set({ parentId: doc.id }).where(inArray(drops.id, ids))
}

/** What the publisher says about a drop's life. Later versions inherit it unless they say otherwise. */
export interface LifetimeInput { lifetime?: Lifetime; keepReason?: string; note?: string }

/**
 * Agents may keep a drop when they say why; people just choose. On a Drop that turned keeping off, only admins keep.
 * Returns the columns to store.
 */
export function lifetimeFields(who: Identity, input: LifetimeInput, previous: Pick<DropRow, "lifetime" | "keepReason"> | null, event?: H3Event) {
  const lifetime = input.lifetime ?? previous?.lifetime ?? "review"
  if (lifetime !== "keep") return { lifetime, keepReason: null }
  if (!input.lifetime) return { lifetime, keepReason: previous?.keepReason ?? null }
  if (!expiryPolicy(event).custom && who.role !== "admin") throw new HTTPError({ status: 403, statusText: "Only admins can keep drops on this Drop. Use review instead." })
  const reason = input.keepReason?.trim().replace(/\s+/g, " ")
  if (who.actorKind === "agent" && !reason) throw new HTTPError({ status: 400, statusText: "Say why this drop should be kept (keepReason), for example the pull request it belongs to." })
  if (reason && reason.length > MAX_KEEP_REASON) throw new HTTPError({ status: 400, statusText: `Keep the reason under ${MAX_KEEP_REASON} characters.` })
  return { lifetime, keepReason: who.actorKind === "agent" ? reason! : null }
}

async function queueBlobCleanup(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    for (let offset = 0; offset < unique.length; offset += 25)
      await db.insert(blobCleanup).values(unique.slice(offset, offset + 25).map(blobKey => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() }))).onConflictDoNothing()
  }
  catch (error) {
    log.error({ action: "blob-cleanup-queue", error: String(error) })
  }
}

/** Retries cleanup left by an earlier metadata operation, in one batch. */
async function drainBlobCleanup() {
  await deleteBlobKeys((await db.select({ key: blobCleanup.blobKey }).from(blobCleanup).limit(20)).map(item => item.key))
}

/**
 * Deletes blobs whose metadata is already gone. A failure doesn't fail the request (the publish or delete already
 * happened): the keys stay queued and the next drop operation retries them.
 */
async function deleteBlobKeys(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    await Promise.all(unique.map(deleteMarkdownCache))
  }
  catch (error) {
    log.error({ action: "markdown-cache-cleanup", error: String(error) })
    await queueBlobCleanup(unique)
    return
  }
  const [error] = await blob.del(unique)
  if (error) {
    log.error({ action: "blob-cleanup", error: error.message, keys: unique.length })
    await queueBlobCleanup(unique)
    return
  }
  for (let offset = 0; offset < unique.length; offset += 80)
    await db.delete(blobCleanup).where(inArray(blobCleanup.blobKey, unique.slice(offset, offset + 80)))
}

/**
 * Stores one file as a private doc drop. Markdown and HTML must be UTF-8. `slug` names the link (the previous
 * version's, or the title's, otherwise); with `nameFromSlug` the file is called after it too, keeping the extension.
 * `folder` (checked by `requireFolder`) places a new drop in it. A drop in a folder lives as long as the folder, so it
 * takes no lifetime of its own, and its slug gets a number when another drop in the folder has it.
 */
export async function createDocDrop(who: Identity, input: LifetimeInput & { filename: string; bytes: Uint8Array; title?: string; slug?: string; nameFromSlug?: boolean; supersedes?: string; visibility?: Visibility; access?: Access; folder?: DropRow }, event?: H3Event) {
  await drainBlobCleanup()
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
  let filename = input.filename.replace(/[/\\]/g, "-").slice(0, 200) || "drop"
  const extension = filename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""
  let kind = kindFromFilename(filename)
  let contentType = detectContentType(input.bytes) ?? "application/octet-stream"
  let text: string | undefined
  if ([".md", ".markdown", ".html", ".htm", ".txt"].includes(extension)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
    }
    catch {
      throw new HTTPError({ status: 400, statusText: `${kind === "html" ? "HTML" : "Text"} files must contain valid UTF-8.` })
    }
    contentType = kind === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8"
  }
  if (kind === "file" && contentType.startsWith("image/")) kind = "image"

  let previous: DropRow | null = null
  const supersedes = input.supersedes ?? (text ? splitFrontmatter(text).frontmatter?.match(/^supersedes:\s*["']?(?:\S*\/)?([0-9a-f-]{36})(?:\.\w+)?["']?\s*$/m)?.[1] : undefined)
  if (supersedes) {
    const found = await findDrop(supersedes) ?? await findDropByBlob(supersedes)
    const can = found && permissions(found, who)
    // An expired drop is read-only even for its owner, so check the Trash before the edit right.
    if (found?.expired && can && can.manage) throw new HTTPError({ status: 409, statusText: "That drop is in the Trash. Restore it first, or publish a new drop." })
    if (found && can && can.edit) {
      if (found.kind === "app") throw new HTTPError({ status: 400, statusText: "That drop is an app; publish its next version with files." })
      if (!can.manage && kind !== found.kind) throw new HTTPError({ status: 403, statusText: "Only the drop's owner can change what kind of file it is." })
      previous = (await versionChain(found))[0] ?? found
    }
  }
  const folder = previous ? null : input.folder ?? null
  const parentId = previous?.parentId ?? folder?.id ?? null
  const ownerId = previous?.ownerId ?? folder?.ownerId ?? who.userId
  const life = parentId ? lifetimeFields(who, {}, previous ?? folder, event) : lifetimeFields(who, input, previous, event)

  return withDropQuota(ownerId, { drops: previous ? 0 : 1, bytes: input.bytes.byteLength, writes: 1, targetId: previous?.id }, event, async (quota) => {
    const key = `${crypto.randomUUID()}${extension}`
    const [storageError] = await blob.put(key, input.bytes, { access: "private", contentType })
    if (storageError) {
      await deleteBlobKeys([key])
      throw storageFailure(storageError)
    }

    // Renders once at upload: the title comes from Comark, and the first view hits a warm cache.
    let parsedTitle: string | undefined
    try {
      parsedTitle = kind === "markdown" && text ? (await renderMarkdownCached(key, text, event)).title : undefined
    }
    catch (error) {
      await deleteBlobKeys([key])
      throw error
    }
    const markdownTitle = parsedTitle === "Untitled document" ? undefined : parsedTitle
    const now = Date.now()
    const title = (input.title?.trim() || markdownTitle || titleFromSource(text ?? "", kind, filename)).slice(0, 160)
    const named = (input.slug && slugify(input.slug)) || previous?.slug || slugify(title)
    const slug = named === previous?.slug ? named : await uniqueSlug(parentId, named, previous?.link)
    if (input.nameFromSlug) filename = `${slug || "doc"}${extension}`
    const row: DropRow = {
      id: crypto.randomUUID(),
      ownerId,
      kind,
      title,
      filename,
      blobKey: key,
      contentType,
      size: input.bytes.byteLength,
      version: (previous?.version ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      link: previous?.link ?? newLink(),
      slug,
      visibility: input.visibility ?? previous?.visibility ?? "private",
      access: input.access ?? (previous?.access as Access | undefined) ?? "comment",
      actorKind: who.actorKind,
      actorName: who.actorName,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      ...life,
      note: input.note?.trim() || null,
      trashedAt: null,
      trashReason: null,
      parentId,
      shareReview: (input.visibility ?? previous?.visibility ?? "private") !== "private" ? await shareReviewFor(ownerId, event) : null,
      quarantinedAt: null,
      publishToken: null,
      siteUrl: null,
    }
    try {
      // A new version is a visit: the older versions restart their window with it, and take its lifetime.
      const chain = previous ? [renewDrop(previous, now), db.update(drops).set(life).where(sql`${drops.id} IN (${chainOf(previous)})`)] : []
      await quota.commit([db.insert(drops).values(row), ...textStatements(row, text, previous?.id), ...chain, ...(folder ? [touchFolder(folder.id, now)] : [])], previous ? exists(db.select({ id: drops.id }).from(drops).where(eq(drops.id, previous.id))) : sql`1`)
    }
    catch (error) {
      await deleteBlobKeys([key])
      if (previous && /unique|constraint/i.test(String(error)))
        throw new HTTPError({ status: 409, statusText: "This drop was published by someone else. Retry from the latest version.", cause: error })
      throw error
    }
    if (text && TEXT_KINDS.has(kind)) await adoptAttachments(row, text, previous)
    // TODO(repo-mirror): also commit this version to a repo the owner picks, one commit per version with the note
    // as its message. Drop stays the source of truth: versions keep living in Blob and the database on every host.
    // Waits on a public app-facing API in @vite-hub/forge (`commitFiles()` through the `forges` library), which is
    // internal-only on vite-hub/vitehub's feat/forge-primitive branch today, and on a token that may write to the
    // owner's repo (a GitHub App install, or a wider scope on GitHub sign-in).
    return row
  })
}

function cleanPath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(part => part && part !== "." && part !== "..").join("/")
  if (!clean || clean.length > 300) throw new HTTPError({ status: 400, statusText: `Invalid file path: ${path}` })
  return clean
}

/**
 * TODO(app-history): an app's next version replaces its files in place (same row, old blobs deleted), so apps have
 * no History tab, nothing to compare, and their comments never go outdated. Keeping each version (a row per version
 * like docs, or ViteHub Workspace history) would give them all three.
 *
 * Creates an app drop, or publishes the next version of one you may edit. A next version starts from the previous
 * one's files: `files` adds or replaces paths, and a path leaves the app only when `removes` names it, so an agent
 * that sends just the files it changed can't delete the rest by accident. `folder` places a new app in it, as in
 * `createDocDrop`.
 */
export async function publishApp(who: Identity, input: LifetimeInput & { id?: string; name?: string; slug?: string; files: Record<string, string>; removes?: string[]; visibility?: Visibility; access?: Access; folder?: DropRow }, event?: H3Event) {
  const entries = Object.entries(input.files ?? {}).map(([path, content]) => [cleanPath(path), String(content)] as const)
  if (new Set(entries.map(([path]) => path)).size !== entries.length) throw new HTTPError({ status: 400, statusText: "An app cannot contain duplicate paths." })
  const removes = [...new Set((input.removes ?? []).map(cleanPath))]
  const clash = removes.filter(path => entries.some(([sent]) => sent === path))
  if (clash.length) throw new HTTPError({ status: 400, statusText: `removes and files both name ${clash.join(", ")}. Send a file to keep it, or name it in removes to delete it.` })
  const encoder = new TextEncoder()
  const encoded = entries.map(([path, content]) => [path, encoder.encode(content)] as const)
  if (entries.length > MAX_APP_FILES) throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  if (encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0) > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "An app can be at most 4 MiB." })
  if (input.id && !entries.length && !removes.length) throw new HTTPError({ status: 400, statusText: "Send the files that changed, or name files in removes." })

  await drainBlobCleanup()
  const now = Date.now()
  let row: DropRow | null = input.id ? await findDrop(input.id) : null
  if (input.id && (!row || row.kind !== "app")) throw new HTTPError({ status: 404, statusText: "No app with that id." })
  // An expired app is read-only even for its owner, so check the Trash before the edit right. Apps have no version chain.
  if (row?.expired && permissions(row, who).manage) throw new HTTPError({ status: 409, statusText: "That app is in the Trash. Restore it first, or publish a new app." })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })
  // The app's own share, not the one a folder gives it: this writes the row.
  const own = row?.raw ?? row
  const folder = row ? null : input.folder ?? null
  const parentId = row?.parentId ?? folder?.id ?? null
  const ownerId = row?.ownerId ?? folder?.ownerId ?? who.userId
  const life = parentId ? lifetimeFields(who, {}, own ?? folder, event) : lifetimeFields(who, input, row, event)
  const note = input.note?.trim() || null
  const visibility = input.visibility ?? own?.visibility ?? "private"
  const shareReview = input.visibility === undefined || input.visibility === own?.visibility
    ? own?.shareReview ?? null
    : input.visibility === "private" ? null : await shareReviewFor(ownerId, event)

  const id = row?.id ?? crypto.randomUUID()
  const prefix = `apps/${id}/${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const old = row ? await db.select({ path: dropFiles.path, blobKey: dropFiles.blobKey, size: dropFiles.size }).from(dropFiles).where(eq(dropFiles.dropId, id)) : []
  const stale = removes.filter(path => !old.some(file => file.path === path))
  if (stale.length) throw new HTTPError({ status: 400, statusText: `removes names ${stale.join(", ")}, which ${stale.length === 1 ? "isn't" : "aren't"} in ${row ? `v${row.version}` : "a new app"}. Nothing was published.` })
  // Files the agent neither sent nor removed carry over, blob and all: no new write, no new bytes.
  const kept = old.filter(file => !removes.includes(file.path) && !entries.some(([path]) => path === file.path))
  const paths = [...kept.map(file => file.path), ...entries.map(([path]) => path)]
  if (!paths.includes("index.html")) throw new HTTPError({ status: 400, statusText: row ? "That would leave the app without an index.html." : "An app needs an index.html." })
  if (paths.length > MAX_APP_FILES) throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  const size = kept.reduce((total, file) => total + file.size, 0) + encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0)
  if (size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "An app can be at most 4 MiB." })
  const oldSize = old.reduce((total, file) => total + file.size, 0)
  return withDropQuota(ownerId, { drops: row ? 0 : 1, bytes: Math.max(0, size - oldSize), writes: entries.length, targetId: row?.id, app: { files: paths.length, bytes: size } }, event, async (quota) => {
    const stagedKeys: string[] = []
    let committedPublish = false
    try {
      for (const [path, bytes] of encoded) {
        const blobKey = `${prefix}/${path}`
        stagedKeys.push(blobKey)
        const [error] = await blob.put(blobKey, bytes, { access: "private", contentType: contentTypeOf(path) })
        if (error) throw storageFailure(error)
      }

      const name = input.name?.trim() || row?.title || "Untitled app"
      const named = (input.slug && slugify(input.slug)) || row?.slug || slugify(name)
      const slug = named === row?.slug ? named : await uniqueSlug(parentId, named, row?.link)
      const next: DropRow = {
        id, ownerId, kind: "app", title: name.slice(0, 160),
        filename: row?.filename ?? `${slug || "app"}/`,
        blobKey: null, contentType: null, size, version: (row?.version ?? 0) + 1, supersedesId: row?.supersedesId ?? null,
        link: row?.link ?? newLink(), slug,
        shareReview, quarantinedAt: own?.quarantinedAt ?? null,
        visibility, access: input.access ?? (own?.access as Access | undefined) ?? "comment",
        actorKind: who.actorKind, actorName: who.actorName, createdAt: row?.createdAt ?? now, updatedAt: now, publishToken: token,
        lastAccessedAt: now, ...life, note, trashedAt: null, trashReason: null, parentId, siteUrl: null,
      }
      const fileRows = [
        ...kept.map(file => ({ dropId: id, path: file.path, blobKey: file.blobKey, size: file.size })),
        ...encoded.map(([path, bytes]) => ({ dropId: id, path, blobKey: `${prefix}/${path}`, size: bytes.byteLength })),
      ]
      if (!row) {
        await quota.commit([
          db.insert(drops).values(next),
          ...quota.fileInserts(fileRows),
          ...(folder ? [touchFolder(folder.id, now)] : []),
        ])
        committedPublish = true
      }
      else {
        const update = db.update(drops).set({ title: next.title, link: next.link, slug, size, version: next.version, actorKind: next.actorKind, actorName: next.actorName, updatedAt: now, lastAccessedAt: now, publishToken: token, ...life, note, visibility, access: next.access, shareReview })
          .where(and(eq(drops.id, id), eq(drops.version, row.version)))
        // The file set changes only if the update above won: both statements check for this publish's token.
        // (Builders, not raw `db.run(sql)`: D1's batch can't bind raw statements.)
        const won = and(eq(drops.id, id), eq(drops.publishToken, token))
        const replace = db.delete(dropFiles).where(and(eq(dropFiles.dropId, id), exists(db.select({ id: drops.id }).from(drops).where(won))))
        const inserts = fileRows.map(file => db.insert(dropFiles).select(qb => qb.select({
          dropId: drops.id,
          path: sql<string>`${file.path}`.as("path"),
          blobKey: sql<string>`${file.blobKey}`.as("blob_key"),
          size: sql<number>`${file.size}`.as("size"),
        }).from(drops).where(won)))
        await quota.commit([update, replace, ...inserts], exists(db.select({ id: drops.id }).from(drops).where(won)))
        committedPublish = true
        await deleteBlobKeys(old.filter(file => !kept.includes(file)).map(file => file.blobKey))
      }
      return Object.assign(next, { warnings: appLinkIssues(Object.fromEntries(entries), paths) })
    }
    catch (error) {
      if (!committedPublish) {
        await deleteBlobKeys(stagedKeys)
      }
      const status = typeof error === "object" && error ? (error as { status?: unknown }).status : undefined
      if (row && status !== 503 && /unique|constraint/i.test(String(error)))
        throw new HTTPError({ status: 409, statusText: "This app was published by someone else. Retry from the latest version.", cause: error })
      throw error
    }
  })
}

/**
 * Moves a drop (every version) to the Trash. Its links stop working; it's purged after 15 days. Everything below it goes
 * with it: the drops below read the Trash from their ancestors, so a folder takes one write.
 */
export async function trashDrop(row: DropRow, now = Date.now()) {
  await db.update(drops).set({ trashedAt: now, trashReason: "deleted" }).where(sql`${drops.id} IN (${chainOf(row)})`)
}

/** Brings a drop back from the Trash with a fresh window, whether it was deleted or expired, and everything below it. */
export async function restoreDrop(row: DropRow, now = Date.now()) {
  await db.update(drops).set({ trashedAt: null, trashReason: null, lastAccessedAt: now }).where(sql`${drops.id} IN (${chainOf(row)})`)
}

/**
 * Removes a drop for good: every version, its files, its comments, the files it embeds, and for a folder everything
 * in it, depth first. `gone` collects the deleted ids, so a chain is deleted once however many of its versions point here.
 */
export async function deleteDrop(row: DropRow, gone = new Set<string>()) {
  await drainBlobCleanup()
  const ids = (await db.select({ id: drops.id }).from(drops).where(sql`${drops.id} IN (${chainOf(row)})`)).map(item => item.id)
  for (const id of ids) gone.add(id)
  const children = await db.select().from(drops).where(sql`${drops.parentId} IN (${chainOf(row)})`)
  for (const child of children) if (!gone.has(child.id)) await deleteDrop(child, gone)
  await deleteRetainedDrop(row, deleteBlobKeys)
  // Live drafts are Blob files too (#live-drafts), one per version anyone opened in the editor.
  if (row.kind === "markdown" && LIVE_EDITING) await deleteBlobKeys(ids.map(draftPath))
}

/** Every drop in someone's Trash, for "Empty Trash". */
export async function emptyTrash(who: Identity, event?: H3Event) {
  const trashed = await listDrops(who, event, { trash: true })
  for (const summary of trashed) {
    const row = await findDrop(summary.id, event)
    if (row) await deleteDrop(row)
  }
  return trashed.length
}

/**
 * The hourly cleanup, in bounded batches (the next run picks up the rest). Drops at the top past their window move to
 * the Trash as of when they expired (the drops below follow them); drops 15 days into the Trash, with everything below
 * them, and nodes whose parent is gone, are deleted.
 */
export async function deleteExpiredDrops(now: Date, limit = 50) {
  const at = now.getTime()
  const { days } = expiryPolicy()
  if (days) {
    const temporary = Math.min(TEMPORARY_DAYS, days)
    const lastSeen = sql`coalesce(${drops.lastAccessedAt}, ${drops.createdAt})`
    await db.update(drops).set({ trashedAt: sql`${lastSeen} + (CASE ${drops.lifetime} WHEN 'temporary' THEN ${temporary} ELSE ${days} END) * ${DAY_MS}`, trashReason: "expired" })
      .where(and(isNull(drops.trashedAt), isNull(drops.parentId), sql`${drops.lifetime} != 'keep'`, sql`${lastSeen} <= ${at} - (CASE ${drops.lifetime} WHEN 'temporary' THEN ${temporary} ELSE ${days} END) * ${DAY_MS}`))
  }
  const due = (await db.select({ drop: drops }).from(dropHeads).innerJoin(drops, eq(drops.id, dropHeads.dropId))
    .where(lte(drops.trashedAt, at - TRASH_DAYS * DAY_MS)).limit(limit)).map(row => row.drop)
  const orphans = await db.select().from(drops)
    .where(and(isNotNull(drops.parentId), sql`NOT EXISTS (SELECT 1 FROM drops p WHERE p.id = ${drops.parentId})`)).limit(limit)
  await drainBlobCleanup()
  for (const row of due) {
    await deleteDrop(row)
    log.info({ action: "drop-purged", drop: row.id, owner: row.ownerId, reason: row.trashReason })
  }
  for (const row of orphans) await deleteDrop(row)
  return due.length + orphans.length
}

/** The doc's share link, which opens its latest version. */
export const dropPageUrl = (origin: string, drop: Pick<DropRow, "id" | "title"> & { link: string | null; slug: string | null }) =>
  new URL(dropPath({ link: drop.link ?? drop.id, slug: drop.slug ?? slugify(drop.title) }), origin).href
