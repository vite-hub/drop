import { eq, inArray, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import { defineSkill, serveSkills, type Skill } from "vite-hub/skills"
import { HUB_SKILLS_PATH, slugify } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import type { SkillInstall } from "#shared/types"
import { drops, user } from "../databases/default/index"
import { currentReview, type DropRow, findDrop, MAX_FILE_BYTES, permissions, readBytes, readText } from "./drops"
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
 *
 * What a request reads is bounded before any file is read, from the sizes the drop rows record: a skill over
 * MAX_SKILL_FILES or MAX_SKILL_BYTES, or past MAX_HUB_BYTES with the skills before it, is left out whole, so a hub never
 * serves part of a skill. Blob reads run READ_POOL at a time, and built skills stay in this isolate (see `built`).
 */

type Row = typeof drops.$inferSelect

/** One skill subfolder's files, by path inside the skill, before their contents are read. */
interface HubEntry {
  name: string
  files: Map<string, { id: string; version: number; blobKey: string; size: number; text: boolean }>
}

const SKILL_SLUG = "skill"

/**
 * Real skills are a SKILL doc, a few references and scripts: tens of files, kilobytes each. 200 files and 8 MiB (two
 * docs at MAX_FILE_BYTES) leave room for a skill that ships schemas or templates.
 */
export const MAX_SKILL_FILES = 200
export const MAX_SKILL_BYTES = 2 * MAX_FILE_BYTES
/**
 * What one request holds at once: the index builds every skill (bytes, then each archive for its digest) before it
 * answers. Three skills at MAX_SKILL_BYTES fit, and so do a hundred real ones; with the cache below that stays far from
 * a Worker's 128 MiB.
 */
export const MAX_HUB_BYTES = 3 * MAX_SKILL_BYTES
/** Blob reads in flight for one request. */
const READ_POOL = 6

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
      .select({ drop: drops, owner: user })
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
  for (const { drop, owner } of below) {
    const ancestors = paths.get(drop.id)!
    // A drop that only looks like it's below (another owner's, outside a team folder) isn't in the hub.
    const at = ancestors.findIndex((node) => node.id === hub.id)
    if (at === -1) continue
    // Each drop as its own `/d/` page opens it: with the review policy as it stands now, the way findDrop reads it.
    const node = await currentReview(
      { ...resolveNode(drop, ancestors, days), ownerBanned: !owner || Boolean(owner.banned) },
      owner,
      event,
    )
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
    if (name)
      skill.files.set([...dirs, name].join("/"), {
        id: row.id,
        version: row.version,
        blobKey: row.blobKey,
        size: row.size,
        text: row.kind === "markdown",
      })
  }
  return servable([...skills.values()].sort((a, b) => a.name.localeCompare(b.name)))
}

/** The skills worth reading: each with a SKILL doc and within the limits, in name order until MAX_HUB_BYTES is spent. */
function servable(entries: HubEntry[]) {
  let total = 0
  return entries.filter((entry) => {
    const bytes = bytesOf(entry)
    if (!entry.files.has("SKILL.md") || entry.files.size > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) return false
    if (total + bytes > MAX_HUB_BYTES) return false
    total += bytes
    return true
  })
}

const bytesOf = (entry: HubEntry) => [...entry.files.values()].reduce((sum, file) => sum + file.size, 0)

/** Runs at most `size` tasks at once; a finished task hands its slot to the next one waiting. */
function pool(size: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < size) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

/**
 * Skills built in this isolate, by their name and the exact file set (path, drop, version) they were built from, so a
 * new version, a rename, a move or a deleted file builds a new one; the skills CLI's index and file requests that
 * follow read no blob. Who may read them is checked on every request (`hubTree`), never here. Only finished builds are
 * kept: Workers stop a request's I/O when its client goes away, so a build another request started may never finish,
 * and a failed read is tried again. Oldest out first, within BUILT_BYTES and BUILT_TTL.
 */
const built = new Map<string, { at: number; bytes: number; skill: Skill | undefined }>()
const BUILT_BYTES = 4 * MAX_SKILL_BYTES
const BUILT_TTL = 5 * 60_000

async function buildSkill(entry: HubEntry, read: ReturnType<typeof pool>) {
  const files = [...entry.files].sort(([a], [b]) => (a < b ? -1 : 1))
  const key = JSON.stringify([entry.name, files.map(([path, file]) => [path, file.id, file.version, file.blobKey])])
  const hit = built.get(key)
  if (hit && Date.now() - hit.at < BUILT_TTL) return hit.skill
  const contents = await Promise.all(
    files.map(async ([path, file]) => [path, await read(() => (file.text ? readText : textOf)(file.blobKey))] as const),
  )
  const skill = skillOf(
    entry.name,
    Object.fromEntries(contents.filter((file): file is readonly [string, string] => file[1] !== undefined)),
  )
  const now = Date.now()
  built.delete(key)
  built.set(key, { at: now, bytes: bytesOf(entry), skill })
  let total = 0
  for (const [cached, { at, bytes }] of [...built].reverse()) {
    total += bytes
    if (total > BUILT_BYTES || now - at >= BUILT_TTL) built.delete(cached)
  }
  return skill
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
  const read = pool(READ_POOL)
  const skills = await Promise.all(
    (tree ?? []).filter((entry) => only === undefined || entry.name === only).map((entry) => buildSkill(entry, read)),
  )
  return skills.filter((skill) => skill !== undefined)
}

/**
 * Names of the skills public hub folder `id` serves, reading only each SKILL doc; empty for any other folder or id.
 * `only` reads just the skill of that name.
 */
export async function hubSkillNames(id: string, event?: H3Event, only?: string): Promise<string[]> {
  const tree = await hubTree(id, event)
  const read = pool(READ_POOL)
  const names = await Promise.all(
    (tree ?? [])
      .filter((entry) => only === undefined || entry.name === only)
      .map(async (entry) => {
        const main = entry.files.get("SKILL.md")!
        return skillOf(entry.name, { "SKILL.md": await read(() => readText(main.blobKey)) })?.name
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
