import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { MAX_RESOURCE_TITLE, MAX_RESOURCE_URL, MAX_RESOURCES, mergeResources, resourceUrl } from "#shared/resources"
import type { DropResource } from "#shared/types"
import { drops } from "../databases/config"
import type { DropRow } from "./drops"

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
export const resourcesOf = (row: Pick<DropRow, "resources">): DropResource[] => row.resources ?? []

/**
 * `list` added to the links `row` has, if any: a link already there keeps its place, so an agent that publishes again
 * never doubles one. Checked before anything is written.
 */
export function addedResources(row: Pick<DropRow, "resources"> | null, list: DropResource[]) {
  const next = row ? mergeResources(resourcesOf(row), list) : list
  if (next.length > MAX_RESOURCES)
    throw new HTTPError({
      status: 400,
      message: `A drop links to at most ${MAX_RESOURCES} pages. Pass resources to update_drop to replace them.`,
    })
  return next
}

/** Sets a drop's links to `list`; an empty one removes them. */
export async function saveResources(row: Pick<DropRow, "id">, list: DropResource[]) {
  await db
    .update(drops)
    .set({ resources: list.length ? list : null })
    .where(eq(drops.id, row.id))
}
