import { and, eq, inArray, isNull, like, or, type SQL, sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { MAX_SLUG } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import { type Share, SHARE_RANK } from "#shared/share"
import { dropHeads, drops } from "../databases/config"
import type { DropRow } from "./drops"
import { isExpired } from "./expiry"
import { shareNow, sharePolicy } from "./share"

// Every drop is a node: it may sit in a folder, and the files a doc embeds hang off the doc. A node takes the widest
// share on its path, the strictest review and quarantine, and the lifetime and Trash of the top-most node. Reads work
// this out from the ancestors, found in one recursive query, so sharing, moving or trashing a folder writes one row.
// A node sits under its owner's folders, or under the team's folders, which hold everyone's drops.

type Row = typeof drops.$inferSelect
export interface Grant {
  share: Share
}

/** The most steps a walk up takes: a full folder path, then a doc, then a file it embeds. */
const MAX_WALK = MAX_DEPTH + 2

/** Each row's ancestors, nearest first, keyed by the row's id. One query per 90 rows: D1 binds at most 100 values. */
export async function ancestorsOf(rows: (Pick<Row, "id" | "parentId" | "ownerId"> & { teamFolder?: boolean })[]) {
  const parents = [...new Set(rows.flatMap((row) => (row.parentId ? [row.parentId] : [])))]
  const byId = new Map<string, Row>()
  for (let offset = 0; offset < parents.length; offset += 90) {
    const seeds = sql.join(
      parents.slice(offset, offset + 90).map((id) => sql`${id}`),
      sql`, `,
    )
    const found = await db
      .select()
      .from(drops)
      .where(
        inArray(
          drops.id,
          sql`(
      WITH RECURSIVE up(id, depth) AS (
        SELECT id, 1 FROM drops WHERE id IN (${seeds})
        UNION ALL SELECT d.parent_id, up.depth + 1 FROM drops d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL AND up.depth < ${MAX_WALK}
      ) SELECT id FROM up
    )`,
        ),
      )
    for (const row of found) byId.set(row.id, row)
  }
  return walkUp(rows, byId)
}

/**
 * The id `hit` selects (a query for at most one id) and the ids of every node above it, so a lookup reads a drop and its
 * ancestors in one query instead of two in a row. `walkUp` walks them the way `ancestorsOf` does.
 */
export const withAncestors = (hit: SQL) => sql`(
  WITH RECURSIVE up(id, depth) AS (
    SELECT id, 0 FROM drops WHERE id = (${hit})
    UNION ALL SELECT d.parent_id, up.depth + 1 FROM drops d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL AND up.depth < ${MAX_WALK}
  ) SELECT id FROM up
)`

/** Each row's ancestors, nearest first, keyed by the row's id, from the nodes `byId` holds. */
export function walkUp(
  rows: (Pick<Row, "id" | "parentId" | "ownerId"> & { teamFolder?: boolean })[],
  byId: Map<string, Row>,
) {
  const result = new Map<string, Row[]>()
  for (const row of rows) {
    const path: Row[] = []
    // A node sits under its owner's nodes, and anyone's under team folders, which only sit under team folders. Nothing
    // writes a cycle, but one would end the walk here too.
    for (let id = row.parentId; id && path.length < MAX_WALK;) {
      const parent = byId.get(id)
      const below = path.at(-1) ?? row
      if (
        !parent ||
        (parent.ownerId !== below.ownerId && !parent.teamFolder) ||
        (below.teamFolder && !parent.teamFolder) ||
        parent.id === row.id ||
        path.includes(parent)
      )
        break
      path.push(parent)
      id = parent.parentId
    }
    result.set(row.id, path)
  }
  return result
}

/**
 * A row as its ancestors make it. `share` becomes the widest share in force on the path (a closed public link counts as
 * what it fell back to), and `grants` keeps every one for `permissions`, which picks the ones that reach the caller.
 * Review and quarantine anywhere above hold the whole subtree. Lifetime and the expiry window come from the top-most node; the nearest node in the Trash puts
 * everything below it there. `raw` keeps the row's own values, which is what changing it edits.
 */
export function resolveNode(row: Row, ancestors: Row[], days: number, now = Date.now()): DropRow {
  // Inside a team's folders, a personal Drop shares like a team one (./share.ts modeFor). Team folders only sit under
  // team folders, so one anywhere on the path puts the whole path in the team.
  const mode =
    sharePolicy().mode === "team" || [row, ...ancestors].some((node) => node.teamFolder && node.teamId)
      ? "team"
      : "personal"
  const own = shareNow(row, now, mode)
  if (!ancestors.length)
    return {
      ...row,
      share: own,
      raw: row,
      ancestors,
      grants: own === "private" ? [] : [{ share: own }],
      expired: Boolean(row.trashedAt) || isExpired(row, now, days),
    }
  const path = [row, ...ancestors]
  const shares = path.map((node) => shareNow(node, now, mode))
  const root = ancestors.at(-1)!
  const widestAt = shares.reduce(
    (best, share, index) => (SHARE_RANK[share] > SHARE_RANK[shares[best]!] ? index : best),
    0,
  )
  const widest = path[widestAt]!
  const trashed = path.find((node) => node.trashedAt)
  const fields: Row = {
    ...row,
    share: shares[widestAt]!,
    shareReview:
      path.find((node) => node.shareReview === "rejected")?.shareReview ??
      path.find((node) => node.shareReview)?.shareReview ??
      null,
    quarantinedAt: path.find((node) => node.quarantinedAt)?.quarantinedAt ?? null,
    lifetime: root.lifetime,
    keepReason: root.keepReason,
    lastAccessedAt: root.lastAccessedAt ?? root.createdAt,
    trashedAt: trashed?.trashedAt ?? null,
    trashReason: trashed?.trashReason ?? null,
  }
  return {
    ...fields,
    raw: row,
    ancestors,
    grants: shares.flatMap((share) => (share === "private" ? [] : [{ share }])),
    ...(widest !== row ? { sharedFrom: { id: widest.id, title: widest.title } } : {}),
    expired: Boolean(fields.trashedAt) || isExpired(fields, now, days),
  }
}

/** Whether a team folder holds it, at any depth: then anyone on the team may add to that folder and trash what's in it. */
export const inTeamFolder = (row: Pick<DropRow, "ancestors">) => Boolean(row.ancestors?.some((node) => node.teamFolder))

/** A file a doc embeds (or a site's screenshot): it hangs off a node that isn't a folder. Unknown ancestors count too. */
export const isAttachment = (row: Pick<DropRow, "parentId" | "ancestors">) =>
  row.parentId !== null && row.ancestors?.[0]?.kind !== "folder"

/** The node directly above, as its own ancestors make it. Null at the top. */
export const parentNode = (row: Pick<DropRow, "ancestors">, days: number) =>
  row.ancestors?.length ? resolveNode(row.ancestors[0]!, row.ancestors.slice(1), days) : null

/** The top-most node, whose lifetime and window the subtree lives by. */
export const rootOf = (row: DropRow) => row.ancestors?.at(-1) ?? row

/** How deep a node sits: 1 at the top. Embedded files don't count. */
export const depthOf = (row: Pick<DropRow, "ancestors" | "kind">) =>
  1 + (row.ancestors?.filter((node) => node.kind === "folder").length ?? 0)

/** The levels a node takes up, itself included: 1, or for a folder its deepest drop's depth below it. */
export async function heightOf(row: Pick<Row, "id" | "kind">) {
  if (row.kind !== "folder") return 1
  const [deepest] = await db.all<{ depth: number }>(sql`WITH RECURSIVE down(id, kind, depth) AS (
    SELECT id, kind, 1 FROM drops WHERE id = ${row.id}
    UNION ALL SELECT d.id, d.kind, down.depth + 1 FROM drops d JOIN down ON d.parent_id = down.id WHERE down.kind = 'folder' AND down.depth <= ${MAX_DEPTH}
  ) SELECT max(depth) AS depth FROM down`)
  return deepest?.depth ?? 1
}

/** A folder and every folder below it, for searching a subtree. */
export const foldersUnder = (id: string) => sql`(
  WITH RECURSIVE down(id, depth) AS (
    SELECT ${id}, 0
    UNION ALL SELECT d.id, down.depth + 1 FROM drops d JOIN down ON d.parent_id = down.id WHERE d.kind = 'folder' AND down.depth < ${MAX_DEPTH}
  ) SELECT id FROM down
)`

/** Drops people list and count: at the top or in a folder, not files a doc embeds. Written for queries on `drops` unaliased. */
export const listedNode = sql`("drops"."parent_id" IS NULL OR EXISTS (SELECT 1 FROM drops p WHERE p.id = "drops"."parent_id" AND p.kind = 'folder'))`

/**
 * `slug`, or `slug-2`, `slug-3` and so on when another drop in the same folder has it, like file names in a directory.
 * Drops at the top need no unique slug: their links tell them apart. `link` is the drop being named, which may keep its own.
 */
export async function uniqueSlug(parentId: string | null, slug: string, link?: string | null) {
  if (!parentId || !slug) return slug
  const siblings = await db
    .select({ slug: drops.slug })
    .from(drops)
    .innerJoin(dropHeads, eq(dropHeads.dropId, drops.id))
    .where(
      and(
        eq(drops.parentId, parentId),
        isNull(drops.trashedAt),
        link ? sql`coalesce(${drops.link}, '') != ${link}` : sql`1`,
        or(eq(drops.slug, slug), like(drops.slug, `${slug}-%`)),
      ),
    )
  const taken = new Set(siblings.map((row) => row.slug))
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const next = `${slug.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "")}${suffix}`
    if (!taken.has(next)) return next
  }
}

/** A folder's time is its latest change, like a directory's: a drop added to it or moved in. */
export const touchFolder = (id: string, now = Date.now()) =>
  db.update(drops).set({ updatedAt: now }).where(eq(drops.id, id))

/** How many drops sit directly in each folder, Trash aside. */
export async function itemCounts(ids: string[]) {
  const counts = new Map<string, number>()
  for (let offset = 0; offset < ids.length; offset += 90) {
    const rows = await db
      .select({ parentId: drops.parentId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(drops)
      .innerJoin(dropHeads, eq(dropHeads.dropId, drops.id))
      .where(and(inArray(drops.parentId, ids.slice(offset, offset + 90)), isNull(drops.trashedAt)))
      .groupBy(drops.parentId)
    for (const row of rows) counts.set(row.parentId!, row.count)
  }
  return counts
}
