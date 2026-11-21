import { eq } from "drizzle-orm"
import { parseYAML } from "confbox"
import { HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database"
import { splitFrontmatter } from "#shared/frontmatter"
import { MAX_RESOURCE_TITLE, MAX_RESOURCE_URL, MAX_RESOURCES, mergeResources, resourceUrl } from "#shared/resources"
import type { DropResource } from "#shared/types"
import { drops } from "../databases/default/index"
import type { DropRow } from "./drops"

const ResourceItem = v.object({
  url: v.pipe(
    v.string(),
    v.maxLength(MAX_RESOURCE_URL),
    v.description("https, or http on localhost, like https://github.com/acme/app/pull/123."),
  ),
  title: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(MAX_RESOURCE_TITLE),
      v.description('What it is, in a few words, like "PR #123" or "Preview". Without one, the page shows its host.'),
    ),
  ),
})

export const ResourcesInput = v.pipe(v.array(ResourceItem), v.maxLength(MAX_RESOURCES))

const FrontmatterResources = v.pipe(
  v.array(
    v.union([
      v.pipe(
        v.string(),
        v.maxLength(MAX_RESOURCE_URL),
        v.transform((url) => ({ url })),
      ),
      ResourceItem,
    ]),
  ),
  v.maxLength(MAX_RESOURCES),
)

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

export function frontmatterResources(markdown: string): DropResource[] {
  const yaml = splitFrontmatter(markdown).frontmatter.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (!yaml) return []
  let data: unknown
  try {
    data = parseYAML(yaml)
  } catch {
    throw new HTTPError({ status: 400, message: "The front matter isn't valid YAML." })
  }
  const listed = v.safeParse(v.looseObject({ resources: v.optional(v.unknown()) }), data)
  if (!listed.success || listed.output.resources === undefined) return []
  const parsed = v.safeParse(FrontmatterResources, listed.output.resources)
  if (!parsed.success)
    throw new HTTPError({
      status: 400,
      message: "List resources in the front matter as addresses, or as url and title pairs, up to 8.",
    })
  return resourceList(parsed.output)
}

export const resourcesOf = (row: Pick<DropRow, "resources">): DropResource[] => row.resources ?? []

export function addedResources(row: Pick<DropRow, "resources"> | null, list: DropResource[]) {
  const next = row ? mergeResources(resourcesOf(row), list) : list
  if (next.length > MAX_RESOURCES)
    throw new HTTPError({
      status: 400,
      message: `A drop links to at most ${MAX_RESOURCES} pages. Pass resources to update_drop to replace them.`,
    })
  return next
}

export async function saveResources(row: Pick<DropRow, "id">, list: DropResource[]) {
  await db
    .update(drops)
    .set({ resources: list.length ? list : null })
    .where(eq(drops.id, row.id))
}
