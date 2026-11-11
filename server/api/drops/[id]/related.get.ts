import { defineHandler, HTTPError } from "h3"
import { isSitePattern } from "#shared/review"
import type { RelatedDrop } from "#shared/types"
import { siteCoversDrop } from "../../../utils/content-origin"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { type LinkTarget, relatedDrops } from "../../../utils/related"
import { resourcesOf } from "../../../utils/resources"

/**
 * The drops related to a drop, for its Related links (server/utils/related.ts): ones that link to the same pages, two
 * links deep, and the site reviews of the pages it links to. A site drop starts from its site, so it lists the docs that
 * link there, like its pull request's before/after doc. Only drops the person would find in Drop anyway.
 */
export default defineHandler(async (event): Promise<RelatedDrop[]> => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  event.res.headers.set("Cache-Control", "private, no-store")
  const seeds: LinkTarget[] = resourcesOf(drop).map((resource) => ({ url: resource.url }))
  if (drop.kind === "site" && drop.siteUrl)
    seeds.push(isSitePattern(drop.siteUrl) ? { site: drop.siteUrl } : { origin: drop.siteUrl })
  const groups = await relatedDrops(seeds, who, event, {
    skip: [drop.id],
    sites: true,
    hide: (url) => siteCoversDrop(event, new URL(url).origin),
  })
  return groups.map((group) => ({
    id: group.drop.id,
    title: group.drop.title,
    kind: group.drop.kind,
    links: group.links,
  }))
})
