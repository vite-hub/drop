import { eq, inArray, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import { defineSkill, serveSkills, type Skill } from "vite-hub/skills"
import { HUB_SKILLS_PATH, slugify } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import type { SkillInstall } from "#shared/types"
import { drops, user } from "../databases/default/index"
import { type DropRow, findDrop, permissions, readBytes, readText } from "./drops"
import { expiryPolicy } from "./expiry"
import { resolveNode, walkUp } from "./nodes"

/**
 * A skill hub: a folder whose direct subfolders are Agent Skills, served as Agent Skills Discovery under the folder's
 * link (`/d/<link>/<slug>/.well-known/agent-skills/…` and `…/.well-known/skills/…`), so `npx skills add <folder link>`
 * installs from it. Layout (skills/skill-hub/SKILL.md): in a skill's subfolder, the Markdown doc with slug `skill` is
 * `SKILL.md`, other Markdown docs are `<folders>/<slug>.md`, and text file drops keep their file name under their folders.
 *
 * Only what an anonymous reader opens through a public link is served: the folder passes the check the `/d/<link>` page
 * makes for a signed-out visitor, and so does each drop in it. Anything else is a hub with no skills, never an error: on
 * a non-OK answer the skills CLI falls back to the origin's own index and would offer Drop's skills under the hub's name.
 */

type Row = typeof drops.$inferSelect

/** One skill subfolder's files, by path inside the skill, before their contents are read. */
interface HubEntry {
  name: string
  files: Map<string, { blobKey: string; text: boolean }>
}

const SKILL_SLUG = "skill"

/** A drop's name as a path segment: its slug, or its title's. Empty when nothing readable is left. */
const segmentOf = (row: Row) => row.slug ?? slugify(row.title)

/** A file drop's name, as long as it stays one path segment. */
const fileName = (name: string) => (name && name !== "." && name !== ".." && !/[/\\\0]/.test(name) ? name : undefined)

/**
 * The public folder `id`'s skill subfolders and the drops in each: two queries that start together (the folder as the
 * page reads it, and everything below it), so one round trip. Null when an anonymous reader can't open the folder.
 */
async function hubTree(id: string, event?: H3Event): Promise<HubEntry[] | null> {
  const [folder, below] = await Promise.all([
    findDrop(id, event),
    db
      .select({ drop: drops, owner: user.id, banned: user.banned })
      .from(drops)
      .leftJoin(user, eq(user.id, drops.ownerId))
      .where(
        inArray(
          drops.id,
          sql`(
      WITH RECURSIVE down(id, kind, depth) AS (
        SELECT id, kind, 0 FROM drops WHERE id = ${id}
        UNION ALL SELECT d.id, d.kind, down.depth + 1 FROM drops d JOIN down ON d.parent_id = down.id
          WHERE down.kind = 'folder' AND d.trashed_at IS NULL AND down.depth < ${MAX_DEPTH}
      ) SELECT id FROM down WHERE depth > 0
    )`,
        ),
      ),
  ])
  if (!folder || folder.kind !== "folder" || !permissions(folder, null).view) return null

  const { days } = expiryPolicy(event)
  const hub = folder.raw ?? folder
  const byId = new Map<string, Row>(
    [hub, ...(folder.ancestors ?? []), ...below.map((row) => row.drop)].map((row) => [row.id, row]),
  )
  const paths = walkUp(
    below.map((row) => row.drop),
    byId,
  )
  const skills = new Map<string, HubEntry>()
  const entries: { row: Row; folders: Row[] }[] = []
  for (const { drop, owner, banned } of below) {
    const ancestors = paths.get(drop.id)!
    // A drop that only looks like it's below (another owner's, outside a team folder) isn't in the hub.
    const at = ancestors.findIndex((node) => node.id === hub.id)
    if (at === -1) continue
    const node = { ...resolveNode(drop, ancestors, days), ownerBanned: !owner || Boolean(banned) }
    if (!permissions(node, null).view) continue
    // The folders from the skill subfolder down to the drop's own.
    const folders = ancestors.slice(0, at).reverse()
    if (!folders.length) {
      const name = segmentOf(drop)
      if (drop.kind === "folder" && name) skills.set(drop.id, { name, files: new Map() })
    } else entries.push({ row: drop, folders })
  }
  for (const { row, folders } of entries) {
    const skill = skills.get(folders[0]!.id)
    const dirs = folders.slice(1).map(segmentOf)
    if (!skill || !row.blobKey || dirs.some((dir) => !dir)) continue
    const name =
      row.kind === "markdown"
        ? !dirs.length && segmentOf(row) === SKILL_SLUG
          ? "SKILL.md"
          : segmentOf(row) && `${segmentOf(row)}.md`
        : ["file", "image", "html"].includes(row.kind)
          ? fileName(row.filename)
          : undefined
    if (name) skill.files.set([...dirs, name].join("/"), { blobKey: row.blobKey, text: row.kind === "markdown" })
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The skill built from `files`, when its `SKILL.md` is valid and names the subfolder it sits in. */
function skillOf(name: string, files: Record<string, string>): Skill | undefined {
  try {
    const skill = defineSkill(files)
    return skill.name === name ? skill : undefined
  } catch {
    // A SKILL doc without valid frontmatter isn't a skill: the hub leaves it out.
    return undefined
  }
}

/** A file drop's text, or undefined for a binary one: skills are served as text. */
async function textOf(blobKey: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(blobKey))
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/** The skills a public hub folder serves, every file read; `only` reads just the skill of that name. */
export async function hubSkills(id: string, event?: H3Event, only?: string): Promise<Skill[]> {
  const tree = await hubTree(id, event)
  const wanted = (tree ?? []).filter((entry) => only === undefined || entry.name === only)
  const built = await Promise.all(
    wanted.map(async (entry) => {
      if (!entry.files.has("SKILL.md")) return undefined
      const files = await Promise.all(
        [...entry.files].map(
          async ([path, file]) => [path, await (file.text ? readText : textOf)(file.blobKey)] as const,
        ),
      )
      return skillOf(
        entry.name,
        Object.fromEntries(files.filter((file): file is readonly [string, string] => file[1] !== undefined)),
      )
    }),
  )
  return built.filter((skill) => skill !== undefined)
}

/**
 * Names of the skills public hub folder `id` serves, reading only each SKILL doc; empty for any other folder or id.
 * `only` reads just the skill of that name.
 */
export async function hubSkillNames(id: string, event?: H3Event, only?: string): Promise<string[]> {
  const tree = await hubTree(id, event)
  const names = await Promise.all(
    (tree ?? [])
      .filter((entry) => only === undefined || entry.name === only)
      .map(async (entry) => {
        const main = entry.files.get("SKILL.md")
        return main && skillOf(entry.name, { "SKILL.md": await readText(main.blobKey) })?.name
      }),
  )
  return names.filter((name) => name !== undefined)
}

/**
 * What the Install button on folder `row`'s page copies: the folder's own link when it's a hub serving skills, or its
 * parent hub's link and the skill's name when it is one of the skills a hub serves. Only for a folder a signed-out
 * visitor opens; the caller checks that first, so other folders pay no query. Both reads start together.
 */
export async function hubInstall(row: DropRow, event?: H3Event): Promise<SkillInstall | undefined> {
  const parent = row.ancestors?.[0]
  const name = segmentOf(row)
  const [own, above] = await Promise.all([
    hubSkillNames(row.id, event),
    parent?.kind === "folder" && name ? hubSkillNames(parent.id, event, name) : [],
  ])
  if (own.length) return { link: row.id, slug: name, skills: own.length }
  if (parent && above.length) return { link: parent.id, slug: segmentOf(parent), skill: above[0] }
  return undefined
}

/**
 * Answers a discovery request under a folder's link, or undefined for any other path. The index reads every skill; a
 * file or an archive reads only the skill it names.
 */
export async function serveHubSkills(event: H3Event): Promise<Response | undefined> {
  const hub = HUB_SKILLS_PATH.exec(event.url.pathname)
  if (!hub) return undefined
  const base = hub[0]
  const rest = event.url.pathname.slice(base.length).replace(/^\/\.well-known\/(?:agent-skills|skills)\//, "")
  const only = rest === "index.json" ? undefined : rest.split("/")[0]!.replace(/\.tar\.gz$/, "")
  let id: string
  try {
    id = decodeURIComponent(hub[1]!)
  } catch {
    return serveSkills(event.req, [], { base })
  }
  return serveSkills(event.req, () => hubSkills(id, event, only), { base })
}
