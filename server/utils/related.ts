import { and, desc, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { siteAddressesFor, siteMatches } from "#shared/review"
import { isPublic } from "#shared/share"
import type { DropResource } from "#shared/types"
import { drops, dropVisits } from "../databases/config"
import { d1Chunks } from "./d1"
import { type DropRow, findDrop, permissions, reaches } from "./drops"
import type { Identity } from "./identity"
import { listedNode } from "./nodes"
import { resourcesOf } from "./resources"
import { sharePolicy } from "./share"

/**
 * Related drops. Nothing stores a relation: drops are related through the pages they link to (their `resources`,
 * #shared/resources). A pull request's before/after doc lists the PR and its preview, so it is related to the preview's
 * site, to the PR, and to every other drop that lists the PR. A site drop is related to the drops that link to the site
 * it reviews. Changing a drop's links changes its relations, with nothing to keep in sync.
 *
 * The search follows links two hops out from where it starts, and only through drops the person would find in Drop
 * anyway, so a drop they can't see never leads them to another one.
 */

/**
 * A page that drops link to: any page on an origin, any page on an origin a site pattern covers (`https://*.example.dev`,
 * #shared/review), or one address.
 */
export type LinkTarget = { origin: string } | { site: string } | { url: string }

/** A related drop, with the links of its that weren't already listed. */
export interface RelatedGroup {
  drop: DropRow
  links: DropResource[]
}

/** How many drops one hop finds, newest first, and how many groups the whole search returns. */
const PER_HOP = 20
const MAX_GROUPS = 20
const HOPS = 2

// The stored JSON holds each link as `"url":"<address>"`: an origin matches the start of an address, a pattern the
// host's end and the path's start, an address the whole of it. resourceUrl() normalizes every stored address, so the
// same page is the same text.
const patternOf = (target: LinkTarget) =>
  "origin" in target ? `"${target.origin}/` : "site" in target ? `${target.site.split("*")[1]}/` : `"${target.url}"`
const hits = (url: string, target: LinkTarget) =>
  "origin" in target
    ? new URL(url).origin === target.origin
    : "site" in target
      ? siteMatches(target.site, new URL(url).origin)
      : url === target.url

/** Non-site drops whose links hit one of `targets`. A cheap match on the stored JSON, which `linkingDrops` checks again. */
const linking = (targets: LinkTarget[]) =>
  and(
    isNotNull(drops.resources),
    // instr, not LIKE: D1 refuses LIKE patterns over 50 bytes, and an address can be longer.
    or(...targets.map((target) => sql`instr(${drops.resources}, ${patternOf(target)}) > 0`)),
    ne(drops.kind, "site"),
    listedNode,
    isNull(drops.trashedAt),
    isNull(drops.quarantinedAt),
  )

/** Whether any drop links to a page on `origin`. That much is all a page learns before it has a token. */
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

/** Refill past skipped, inexact, and inaccessible matches: only eligible drops consume the per-hop budget. */
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

/** The drops, outside `skip`, whose links hit one of `targets`, checked link by link: a title quoting an address doesn't count. */
async function linkingDrops(targets: LinkTarget[], skip: Set<string>, who: Identity, event?: H3Event) {
  const found = new Map<string, DropRow>()
  for (const chunk of d1Chunks(targets))
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

/** The site drops, outside `skip`, that review a page `targets` point at, like the preview a doc links to. */
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
  for (const chunk of d1Chunks(addresses))
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

/**
 * The drops related to `seeds` that `who` would find in Drop, as groups: each drop with its links, where a link already
 * listed, one that `hide` names, and the seeds themselves stay out. The first hop finds the drops that link to a seed;
 * the second, the drops that link to a page one of those links to. Site drops reviewing those pages come with
 * `sites`. Guests find none.
 */
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

/** Only a currently open, approved public link on the path can grant discovery from a recorded visit. */
const publicPathOf = (drop: DropRow, now: number) =>
  [drop.raw ?? drop, ...(drop.ancestors ?? [])]
    .filter(
      (node) => isPublic(node.share) && !node.shareReview && (node.publicUntil === null || node.publicUntil > now),
    )
    .map((node) => node.id)
const grantsOf = (drop: DropRow) => drop.grants ?? [{ share: drop.share }]

/**
 * The ones of `found` that `who` would find in Drop anyway: their own, ones a team share reaches, and public links on a
 * team Drop, or on a personal Drop the ones they opened while signed in, as Shared with me lists them. A public link
 * nobody gave them stays hidden, since finding a drop through a page it links to is not having its link. Admins don't
 * find other people's private drops this way.
 */
export async function findableBy(who: Identity, found: DropRow[], event?: H3Event) {
  const viewable = found.filter((drop) => permissions(drop, who).view)
  const shared = new Set(
    viewable.filter(
      (drop) =>
        drop.ownerId === who.userId ||
        reaches({ ...drop, grants: grantsOf(drop).filter((grant) => !isPublic(grant.share)) }, who),
    ),
  )
  // A public link: a team Drop lists it for the team, a personal one once they opened it, or the folder it's in.
  const linked = new Set(
    viewable.filter((drop) => !shared.has(drop) && grantsOf(drop).some((grant) => isPublic(grant.share))),
  )
  if (sharePolicy(event).mode === "team") return viewable.filter((drop) => shared.has(drop) || linked.has(drop))
  const now = Date.now()
  const visited = new Set<string>()
  for (const ids of d1Chunks([...new Set([...linked].flatMap((drop) => publicPathOf(drop, now)))]))
    for (const row of await db
      .select({ id: dropVisits.dropId })
      .from(dropVisits)
      .where(and(eq(dropVisits.userId, who.userId), inArray(dropVisits.dropId, ids))))
      visited.add(row.id)
  return viewable.filter(
    (drop) => shared.has(drop) || (linked.has(drop) && publicPathOf(drop, now).some((id) => visited.has(id))),
  )
}
