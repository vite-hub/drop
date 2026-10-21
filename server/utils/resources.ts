import { asc, eq, sql } from "drizzle-orm"
import { log } from "evlog"
import { HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { MAX_RESOURCE_TITLE, MAX_RESOURCE_URL, MAX_RESOURCES, mergeResources, resourceUrl } from "#shared/resources"
import type { DropResource } from "#shared/types"
import { dropResources } from "../databases/config"
import type { DropRow } from "./drops"

type Linked = Pick<DropRow, "id" | "link">

// Databases set up before links existed lack the table, and production's schema changes by hand: each isolate creates
// it before its first read or write, with the statements in 0000_init.sql, so a deploy needs no step of its own.
const TABLE = [
  "CREATE TABLE IF NOT EXISTS `drop_resources` (`link` text NOT NULL, `url` text NOT NULL, `title` text, `position` integer NOT NULL, PRIMARY KEY(`link`, `url`))",
  "CREATE TRIGGER IF NOT EXISTS `drop_resources_drop_delete` AFTER DELETE ON `drops` WHEN NOT EXISTS (SELECT 1 FROM drops d WHERE d.link = OLD.link) BEGIN DELETE FROM `drop_resources` WHERE `link` = coalesce(OLD.link, OLD.id); END",
]
let table: Promise<void> | undefined
function ensureTable() {
  table ??= (async () => {
    for (const statement of TABLE) await db.run(sql.raw(statement))
  })().catch((error: unknown) => {
    table = undefined
    throw error
  })
  return table
}

/** How `publish` and `update_drop` take a drop's links. */
export const ResourcesInput = v.pipe(
  v.array(
    v.object({
      url: v.pipe(
        v.string(),
        v.maxLength(MAX_RESOURCE_URL),
        v.description("https, or http on localhost, like https://github.com/acme/app/pull/123."),
      ),
      title: v.optional(
        v.pipe(
          v.string(),
          v.maxLength(MAX_RESOURCE_TITLE),
          v.description(
            'What it is, in a few words, like "PR #123" or "Preview". Without one, the page shows its host.',
          ),
        ),
      ),
    }),
  ),
  v.maxLength(MAX_RESOURCES),
)

/** The links an agent sent, checked and normalized: one per page, the last title given for it winning. */
export function resourceList(input: v.InferOutput<typeof ResourcesInput>): DropResource[] {
  const list: DropResource[] = []
  for (const item of input) {
    const url = resourceUrl(item.url)
    if (!url)
      throw new HTTPError({ status: 400, message: `${item.url} isn't a link: use https, or http on localhost.` })
    const title = item.title?.trim()
    list.push({ url, ...(title ? { title } : {}) })
  }
  return mergeResources([], list)
}

/** A drop's links, the same on every version. */
export async function resourcesOf(row: Linked): Promise<DropResource[]> {
  try {
    await ensureTable()
    const rows = await db
      .select({ url: dropResources.url, title: dropResources.title })
      .from(dropResources)
      .where(eq(dropResources.link, row.link ?? row.id))
      .orderBy(asc(dropResources.position))
    return rows.map(({ url, title }) => ({ url, ...(title ? { title } : {}) }))
  } catch (error) {
    // A drop's page still opens without them.
    log.error({ action: "drop-resources", error: String(error) })
    return []
  }
}

/**
 * `list` added to the links `row` has, if any: a link already there keeps its place, so an agent that publishes again
 * never doubles one. Checked before anything is written.
 */
export async function addedResources(row: Linked | null, list: DropResource[]) {
  const next = row ? mergeResources(await resourcesOf(row), list) : list
  if (next.length > MAX_RESOURCES)
    throw new HTTPError({
      status: 400,
      message: `A drop links to at most ${MAX_RESOURCES} pages. Pass resources to update_drop to replace them.`,
    })
  return next
}

/** Sets a drop's links to `list`; an empty one removes them. */
export async function saveResources(row: Linked, list: DropResource[]) {
  await ensureTable()
  const link = row.link ?? row.id
  const remove = db.delete(dropResources).where(eq(dropResources.link, link))
  if (!list.length) return void (await remove)
  await db.batch([
    remove,
    db
      .insert(dropResources)
      .values(list.map((resource, position) => ({ link, url: resource.url, title: resource.title ?? null, position }))),
  ])
}
