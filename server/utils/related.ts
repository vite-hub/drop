import { and, desc, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { chunkParameters, db } from "vite-hub/database"
import { siteAddressesFor, siteMatches } from "#shared/review"
import { isPublic } from "#shared/share"
import type { DropResource } from "#shared/types"
import { drops, dropVisits } from "../databases/default/index"
import { type DropRow, findDrop, permissions, reaches } from "./drops"
import type { Identity } from "./identity"
import { listedNode } from "./nodes"
import { resourcesOf } from "./resources"
import { sharePolicy } from "./share"

export type LinkTarget = { origin: string } | { site: string } | { url: string }

export interface RelatedGroup {
  drop: DropRow
  links: DropResource[]
}

const PER_HOP = 20
const MAX_GROUPS = 20
const HOPS = 2

const patternOf = (target: LinkTarget) =>
  "origin" in target ? `"${target.origin}/` : "site" in target ? `${target.site.split("*")[1]}/` : `"${target.url}"`
const hits = (url: string, target: LinkTarget) =>
  "origin" in target
    ? new URL(url).origin === target.origin
    : "site" in target
      ? siteMatches(target.site, new URL(url).origin)
      : url === target.url

const linking = (targets: LinkTarget[]) =>
  and(
    isNotNull(drops.resources),
    or(...targets.map((target) => sql`instr(${drops.resources}, ${patternOf(target)}) > 0`)),
    ne(drops.kind, "site"),
    listedNode,
    isNull(drops.trashedAt),
    isNull(drops.quarantinedAt),
  )

export async function linkedFrom(origin: string) {
  for (let offset = 0; ; offset += PER_HOP) {
    const rows = await db
      .select({ resources: drops.resources })
      .from(drops)
      .where(linking([{ origin }]))
      .orderBy(desc(drops.updatedAt), desc(drops.id))
      .limit(PER_HOP)
      .offset(offset)
    if (rows.some((row) => resourcesOf(row).some((resource) => hits(resource.url, { origin })))) return true
    if (rows.length < PER_HOP) return false
  }
}

const newestFirst = (rows: DropRow[]) => rows.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, PER_HOP)

async function findableMatches(
  where: SQL | undefined,
  matches: (drop: DropRow) => boolean,
  skip: Set<string>,
  who: Identity,
  event?: H3Event,
) {
  const found: DropRow[] = []
  for (let offset = 0; found.length < PER_HOP; offset += PER_HOP) {
    const rows = await db
      .select({ id: drops.id })
      .from(drops)
      .where(where)
      .orderBy(desc(drops.updatedAt), desc(drops.id))
      .limit(PER_HOP)
      .offset(offset)
    const candidates = await Promise.all(rows.filter((row) => !skip.has(row.id)).map((row) => findDrop(row.id, event)))
    found.push(
      ...(await findableBy(
        who,
        candidates.filter((drop): drop is DropRow => drop !== null && matches(drop)),
        event,
      )),
    )
    if (rows.length < PER_HOP) break
  }
  return newestFirst(found)
}

async function linkingDrops(targets: LinkTarget[], skip: Set<string>, who: Identity, event?: H3Event) {
  const found = new Map<string, DropRow>()
  for (const chunk of chunkParameters(targets, { reserved: 10 }))
    for (const drop of await findableMatches(
      linking(chunk),
      (candidate) => resourcesOf(candidate).some((resource) => targets.some((target) => hits(resource.url, target))),
      skip,
      who,
      event,
    ))
      found.set(drop.id, drop)
  return newestFirst([...found.values()])
}

async function reviewingSites(targets: LinkTarget[], skip: Set<string>, who: Identity, event?: H3Event) {
  const origins = [
    ...new Set(
      targets.flatMap((target) =>
        "origin" in target ? [target.origin] : "url" in target ? [new URL(target.url).origin] : [],
      ),
    ),
  ]
  const addresses = [...new Set(origins.flatMap(siteAddressesFor))]
  const found = new Map<string, DropRow>()
  for (const chunk of chunkParameters(addresses, { reserved: 10 }))
    for (const drop of await findableMatches(
      and(
        eq(drops.kind, "site"),
        inArray(drops.siteUrl, chunk),
        listedNode,
        isNull(drops.trashedAt),
        isNull(drops.quarantinedAt),
      ),
      (site) => site.kind === "site" && !!site.siteUrl && origins.some((origin) => siteMatches(site.siteUrl!, origin)),
      skip,
      who,
      event,
    ))
      found.set(drop.id, drop)
  return newestFirst([...found.values()])
}

export async function relatedDrops(
  seeds: LinkTarget[],
  who: Identity | null,
  event: H3Event | undefined,
  options: { skip?: string[]; hide?: (url: string) => boolean; sites?: boolean } = {},
): Promise<RelatedGroup[]> {
  if (!who || seeds.length === 0) return []
  const seen = new Set(options.skip)
  const followed = new Set(seeds.flatMap((seed) => ("url" in seed ? [seed.url] : [])))
  const listed = new Set<string>()
  const hidden = (url: string) => seeds.some((seed) => hits(url, seed)) || options.hide?.(url) === true
  const groups: RelatedGroup[] = []
  let targets = seeds
  for (let hop = 0; hop < HOPS && targets.length && groups.length < MAX_GROUPS; hop++) {
    const found = [
      ...(await linkingDrops(targets, seen, who, event)),
      ...(options.sites ? await reviewingSites(targets, seen, who, event) : []),
    ]
    for (const drop of found) seen.add(drop.id)
    const next: LinkTarget[] = []
    for (const drop of found) {
      const links = resourcesOf(drop).filter((resource) => !hidden(resource.url))
      groups.push({ drop, links: links.filter((resource) => !listed.has(resource.url)) })
      for (const { url } of links) {
        listed.add(url)
        if (!followed.has(url)) next.push({ url })
        followed.add(url)
      }
    }
    targets = next
  }
  return groups.slice(0, MAX_GROUPS)
}

const publicPathOf = (drop: DropRow, now: number) =>
  [drop.raw ?? drop, ...(drop.ancestors ?? [])].flatMap((node) =>
    isPublic(node.share) &&
    (!node.shareReview || !drop.shareReview) &&
    (node.publicUntil === null || node.publicUntil > now)
      ? [node.id]
      : [],
  )
const grantsOf = (drop: DropRow) => drop.grants ?? [{ share: drop.share }]

export async function findableBy(who: Identity, found: DropRow[], event?: H3Event) {
  const viewable = found.filter((drop) => permissions(drop, who).view)
  const shared = new Set(
    viewable.filter(
      (drop) =>
        drop.ownerId === who.userId ||
        reaches({ ...drop, grants: grantsOf(drop).filter((grant) => !isPublic(grant.share)) }, who),
    ),
  )
  const linked = new Set(
    viewable.filter((drop) => !shared.has(drop) && grantsOf(drop).some((grant) => isPublic(grant.share))),
  )
  if (sharePolicy(event).mode === "team") return viewable.filter((drop) => shared.has(drop) || linked.has(drop))
  const now = Date.now()
  const visited = new Set<string>()
  for (const ids of chunkParameters([...new Set([...linked].flatMap((drop) => publicPathOf(drop, now)))], {
    reserved: 10,
  }))
    for (const row of await db
      .select({ id: dropVisits.dropId })
      .from(dropVisits)
      .where(and(eq(dropVisits.userId, who.userId), inArray(dropVisits.dropId, ids))))
      visited.add(row.id)
  return viewable.filter(
    (drop) => shared.has(drop) || (linked.has(drop) && publicPathOf(drop, now).some((id) => visited.has(id))),
  )
}
