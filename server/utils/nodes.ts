import { and, eq, inArray, isNull, like, ne, or, type SQL, sql } from "drizzle-orm"
import { db } from "vite-hub/database"
import { MAX_SLUG } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import { type Share, SHARE_RANK } from "#shared/share"
import { drops } from "../databases/default/index"
import { d1Chunks } from "./d1"
import type { DropRow } from "./drops"
import { isExpired } from "./expiry"
import { shareNow, sharePolicy } from "./share"

type Row = typeof drops.$inferSelect
export interface Grant {
  share: Share
}

const MAX_WALK = MAX_DEPTH + 2

export async function ancestorsOf(rows: (Pick<Row, "id" | "parentId" | "ownerId"> & { teamFolder?: boolean })[]) {
  const parents = [...new Set(rows.flatMap((row) => (row.parentId ? [row.parentId] : [])))]
  const byId = new Map<string, Row>()
  for (const chunk of d1Chunks(parents)) {
    const seeds = sql.join(
      chunk.map((id) => sql`${id}`),
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

export const withAncestors = (hits: SQL) => sql`(
  WITH RECURSIVE up(id, depth) AS (
    SELECT id, 0 FROM drops WHERE id IN (${hits})
    UNION SELECT d.parent_id, up.depth + 1 FROM drops d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL AND up.depth < ${MAX_WALK}
  ) SELECT id FROM up
)`

export function walkUp(
  rows: (Pick<Row, "id" | "parentId" | "ownerId"> & { teamFolder?: boolean })[],
  byId: Map<string, Row>,
) {
  const result = new Map<string, Row[]>()
  for (const row of rows) {
    const path: Row[] = []
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

export function resolveNode(row: Row, ancestors: Row[], days: number, now = Date.now()): DropRow {
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

export const inTeamFolder = (row: Pick<DropRow, "ancestors">) => Boolean(row.ancestors?.some((node) => node.teamFolder))

export const isAttachment = (row: Pick<DropRow, "parentId" | "ancestors">) =>
  row.parentId !== null && row.ancestors?.[0]?.kind !== "folder"

export const parentNode = (row: Pick<DropRow, "ancestors">, days: number) =>
  row.ancestors?.length ? resolveNode(row.ancestors[0]!, row.ancestors.slice(1), days) : null

export const rootOf = (row: DropRow) => row.ancestors?.at(-1) ?? row

export const depthOf = (row: Pick<DropRow, "ancestors" | "kind">) =>
  1 + (row.ancestors?.filter((node) => node.kind === "folder").length ?? 0)

export async function heightOf(row: Pick<Row, "id" | "kind">) {
  if (row.kind !== "folder") return 1
  const [deepest] = await db.all<{ depth: number }>(sql`WITH RECURSIVE down(id, kind, depth) AS (
    SELECT id, kind, 1 FROM drops WHERE id = ${row.id}
    UNION ALL SELECT d.id, d.kind, down.depth + 1 FROM drops d JOIN down ON d.parent_id = down.id WHERE down.kind = 'folder' AND down.depth <= ${MAX_DEPTH}
  ) SELECT max(depth) AS depth FROM down`)
  return deepest?.depth ?? 1
}

export const foldersUnder = (id: string) => sql`(
  WITH RECURSIVE down(id, depth) AS (
    SELECT ${id}, 0
    UNION ALL SELECT d.id, down.depth + 1 FROM drops d JOIN down ON d.parent_id = down.id WHERE d.kind = 'folder' AND down.depth < ${MAX_DEPTH}
  ) SELECT id FROM down
)`

export const listedNode = sql`("drops"."parent_id" IS NULL OR EXISTS (SELECT 1 FROM drops p WHERE p.id = "drops"."parent_id" AND p.kind = 'folder'))`

export async function uniqueSlug(parentId: string | null, slug: string, id?: string | null) {
  if (!parentId || !slug) return slug
  const siblings = await db
    .select({ slug: drops.slug })
    .from(drops)
    .where(
      and(
        eq(drops.parentId, parentId),
        isNull(drops.trashedAt),
        id ? ne(drops.id, id) : undefined,
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

export const touchFolder = (id: string, now = Date.now()) =>
  db.update(drops).set({ updatedAt: now }).where(eq(drops.id, id))

export async function itemCounts(ids: string[] | SQL) {
  const counts = new Map<string, number>()
  for (const chunk of Array.isArray(ids) ? d1Chunks(ids) : [ids]) {
    const rows = await db
      .select({ parentId: drops.parentId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(drops)
      .where(and(inArray(drops.parentId, chunk), isNull(drops.trashedAt)))
      .groupBy(drops.parentId)
    for (const row of rows) counts.set(row.parentId!, row.count)
  }
  return counts
}
