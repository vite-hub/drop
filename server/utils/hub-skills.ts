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
 * serves part of a skill. So are skills past MAX_HUB_SKILLS or MAX_HUB_FILES, and a skill with a path no skill archive
 * can hold, binary files included, so discovery and the Install button decide from the same rows without reading a
 * blob. A SKILL doc whose frontmatter is over MAX_FRONTMATTER is left out before its YAML is parsed. Blob reads run
 * READ_POOL at a time, builds across the isolate wait for room in `buildBudget`, and built skills stay in this isolate
 * (see `built`).
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
 * What one request builds at once: the index builds every skill (bytes, then each archive for its digest) before it
 * answers. One skill at MAX_SKILL_BYTES fits, and so do a hundred real ones; BUILT_BYTES says why no more.
 */
const MAX_HUB_BYTES = MAX_SKILL_BYTES
/** Skills and files one request builds or checks, empty files included: a hundred real skills fit. */
export const MAX_HUB_SKILLS = 100
export const MAX_HUB_FILES = 2000
/**
 * Characters of a SKILL doc's frontmatter. The Agent Skills spec bounds only `name` (64), `description` (1024) and
 * `compatibility` (500), about 1.6 KiB with their keys; 4 KiB leaves 2.4 KiB for `license`, `allowed-tools` and
 * `metadata`, three times the largest real frontmatter we've seen (1.3 KiB), and keeps parsed YAML (YAML_BYTES a
 * character) to 128 KiB a skill.
 */
export const MAX_FRONTMATTER = 4 * 1024
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

/**
 * The skills worth reading: each with a SKILL doc, within the limits, and with every path a skill archive holds, in name
 * order until MAX_HUB_BYTES is spent.
 */
function servable(entries: HubEntry[]) {
  let total = 0
  let files = 0
  let skills = 0
  return entries.filter((entry) => {
    const bytes = bytesOf(entry)
    if (!entry.files.has("SKILL.md") || entry.files.size > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) return false
    if (!archivable(entry.files.keys())) return false
    if (skills === MAX_HUB_SKILLS || files + entry.files.size > MAX_HUB_FILES || total + bytes > MAX_HUB_BYTES)
      return false
    total += bytes
    files += entry.files.size
    skills++
    return true
  })
}

/** A SKILL doc that is valid on its own, to check the paths beside it. */
const PROBE = "---\nname: probe\ndescription: Checks the paths of a hub skill.\n---\n"

/** Whether a skill archive can hold every one of `paths` (SKILL_INVALID_PATH), checked without reading a file. */
function archivable(paths: Iterable<string>) {
  try {
    defineSkill({ ...Object.fromEntries([...paths].map((path) => [path, ""])), "SKILL.md": PROBE })
    return true
  } catch {
    return false
  }
}

const bytesOf = (entry: HubEntry) => [...entry.files.values()].reduce((sum, file) => sum + file.size, 0)

/** Runs at most `size` tasks at once; a finished task hands its slot to the next one waiting. */
function pool(size: number) {
  let active = 0
  const waiting: (() => void)[] = []
  let failure: { error: unknown } | undefined
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < size) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      if (failure) throw failure.error
      return await task()
    } catch (error) {
      failure ??= { error }
      throw error
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

/** Drain every started task before propagating failure and releasing its memory reservation. */
async function drained<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks)
  const failed = results.find((result) => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

/**
 * Skills built in this isolate, by their name and the exact file set (path, drop, version) they were built from, so a
 * new version, a rename, a move or a deleted file builds a new one; the skills CLI's index and file requests that
 * follow read no blob. Who may read them is checked on every request (`hubTree`), never here. Only finished builds are
 * kept: Workers stop a request's I/O when its client goes away, so a build another request started may never finish,
 * and a failed read is tried again. Oldest out first, within BUILT_BYTES and BUILT_TTL.
 */
const built = new Map<string, { at: number; bytes: number; skill: Skill | undefined }>()
/**
 * The memory hub skills may take in a Worker's 128 MiB, as an upper bound.
 *
 * - A built skill keeps each file as UTF-8 bytes, as text (UTF-16 in V8: up to 2 bytes a character) and inside the gzip
 *   archive (no bigger than the tar): 4 bytes per input byte. While it builds it also holds the tar: 5. Each file adds
 *   its tar header and padding twice and its objects, under FILE_COST, and each skill its parsed frontmatter, at most
 *   MAX_FRONTMATTER × YAML_BYTES = 128 KiB (`costOf`).
 * - The largest request, MAX_HUB_BYTES in MAX_HUB_FILES files over MAX_HUB_SKILLS skills, may take
 *   5 × 8 MiB + 2000 × 3 KiB + 100 × 128 KiB = 58.4 MiB while it builds.
 * - Live requests across the isolate reserve at most BUILDING_BYTES at once, including borrowed cache hits until
 *   serving finishes. One that does not fit waits (`buildBudget`), without holding cache references.
 * - The cache keeps BUILT_BYTES, charged by `charge`: one skill at MAX_SKILL_BYTES is a little over 32 MiB.
 *
 * Borrowed cache entries are conservatively charged in both budgets until eviction or request completion.
 * 60 + 36 = 96 MiB in the worst case (incompressible files, two-byte text, adversarial YAML), which leaves 32 MiB for
 * the app; real skills take a small fraction of it.
 */
export const BUILT_BYTES = 36 * 1024 * 1024
export const BUILDING_BYTES = 60 * 1024 * 1024
const BUILT_TTL = 5 * 60_000
/** Per file: its object, its views, and the digest a one-file skill keeps for it. */
const FILE_OVERHEAD = 512
/** Per file while it builds: its tar header and padding, in the tar and in the archive, and FILE_OVERHEAD. */
const FILE_COST = 3 * 1024
/** Per entry: the key's slot, the skill object and its digest. */
const ENTRY_OVERHEAD = 1024
/** Parsed YAML, at most, per frontmatter character (measured with nested flow collections). */
const YAML_BYTES = 32
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** A SKILL doc's frontmatter as `defineSkill` reads it, unparsed; undefined without one. */
const frontmatterOf = (text: string) => FRONTMATTER.exec(text.replace(/^\uFEFF/, ""))?.[1]

/** The most memory building `files` of `skills` skills may take at once, from the sizes their rows record. */
const costOf = (files: { size: number }[], skills: number) =>
  files.reduce((sum, file) => sum + 5 * file.size + FILE_COST, 0) + skills * MAX_FRONTMATTER * YAML_BYTES

/**
 * Room for builds in this isolate, shared by every request: `acquire(cost)` resolves once `cost` fits beside the builds
 * running (or none is), first come first served, with a release to call in `finally`; or undefined after `waitMs`.
 * Capacity is held until all work finishes; elapsed time cannot establish that allocations are dead.
 * Settings are open for tests.
 */
function budget(limit: number, waitMs: number) {
  const leases = new Set<{ cost: number }>()
  const waiting: { wake: () => void }[] = []
  const wakeAll = () => {
    for (const waiter of waiting) waiter.wake()
  }
  const held = () => [...leases].reduce((total, lease) => total + lease.cost, 0)
  const room = {
    limit,
    waitMs,
    async acquire(cost: number): Promise<(() => void) | undefined> {
      const me = { wake: () => {} }
      waiting.push(me)
      const deadline = Date.now() + room.waitMs
      try {
        for (;;) {
          const now = Date.now()
          const used = held()
          if (waiting[0] === me && (used === 0 || used + cost <= room.limit)) break
          if (now >= deadline) return undefined
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, deadline - now)
            me.wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
        }
      } finally {
        waiting.splice(waiting.indexOf(me), 1)
        wakeAll()
      }
      const lease = { cost }
      leases.add(lease)
      return () => {
        if (leases.delete(lease)) wakeAll()
      }
    },
  }
  return room
}

/** Live request allocations in this isolate: BUILDING_BYTES at once, with a 10 s admission wait. */
export const buildBudget = budget(BUILDING_BYTES, 10_000)
/** Seconds a client should wait after a build found no room. */
const RETRY_AFTER = "10"

/**
 * What a cached skill holds, from above: the key, each file's bytes, text and path, the archive at the tar's size plus
 * zlib's worst-case growth, and the parsed frontmatter.
 */
function charge(key: string, skill: Skill | undefined) {
  let bytes = key.length * 2 + ENTRY_OVERHEAD
  if (!skill) return bytes
  let tar = 1024
  for (const file of skill.files) {
    bytes += file.bytes.buffer.byteLength + (file.text?.length ?? 0) * 2 + file.path.length * 2 + FILE_OVERHEAD
    tar += 512 + Math.ceil(file.bytes.byteLength / 512) * 512
  }
  const frontmatter = frontmatterOf(skill.files[0]!.text!) ?? ""
  return bytes + tar + (tar >> 10) + 64 + frontmatter.length * YAML_BYTES
}

/** Built skills in this isolate's cache, with what each is charged. */
export const builtSkills = () => [...built].map(([key, { bytes, skill }]) => ({ key, bytes, skill }))

/** `entry`'s cache key and sorted files, and its cached build while it's fresh. */
function lookup(entry: HubEntry) {
  const files = [...entry.files].sort(([a], [b]) => (a < b ? -1 : 1))
  const key = JSON.stringify([entry.name, files.map(([path, file]) => [path, file.id, file.version, file.blobKey])])
  const hit = built.get(key)
  return { entry, files, key, hit: hit && Date.now() - hit.at < BUILT_TTL ? hit : undefined }
}

async function buildSkill({ entry, files, key }: ReturnType<typeof lookup>, read: ReturnType<typeof pool>) {
  const contents = await drained(files.map(async ([path, file]) => [path, await read(() => textOf(file))] as const))
  const skill = skillOf(
    entry.name,
    Object.fromEntries(contents.filter((file): file is readonly [string, string] => file[1] !== undefined)),
  )
  keep(key, skill)
  return skill
}

/** Caches `skill` once room is made for it: expired entries go, then the oldest, before it goes in. */
function keep(key: string, skill: Skill | undefined) {
  const bytes = charge(key, skill)
  const now = Date.now()
  built.delete(key)
  let total = 0
  for (const [cached, entry] of built)
    if (now - entry.at >= BUILT_TTL) built.delete(cached)
    else total += entry.bytes
  if (bytes > BUILT_BYTES) return
  for (const [cached, entry] of built) {
    if (total + bytes <= BUILT_BYTES) break
    built.delete(cached)
    total -= entry.bytes
  }
  built.set(key, { at: now, bytes, skill })
}

/** The skill built from `files`, when its `SKILL.md` is valid and names the subfolder it sits in. */
function skillOf(name: string, files: Record<string, string>): Skill | undefined {
  // Before the YAML is parsed: past MAX_FRONTMATTER it can take more memory than a whole skill.
  const frontmatter = files["SKILL.md"] === undefined ? undefined : frontmatterOf(files["SKILL.md"])
  if (frontmatter === undefined || frontmatter.length > MAX_FRONTMATTER) return undefined
  try {
    const skill = defineSkill(files)
    return skill.name === name ? skill : undefined
  } catch {
    // A SKILL doc without valid frontmatter, or a path a skill archive can't hold (SKILL_INVALID_PATH), isn't a
    // skill: the hub leaves it out whole.
    return undefined
  }
}

/** A hub file's text: a Markdown doc's, or a file drop's unless it's binary. Skills are served as text. */
async function textOf(file: { blobKey: string; text: boolean }) {
  if (file.text) return readText(file.blobKey)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(file.blobKey))
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/**
 * The skills a public hub folder serves, every file read; `only` reads just the skill of that name. Skills this isolate
 * built come from `built`, and all entries wait for room in `buildBudget`: undefined when none came in time. `release`
 * gives the room back; call it once the answer is made, since serving builds each archive.
 */
async function hubSkills(id: string, event?: H3Event, only?: string) {
  const tree = await hubTree(id, event)
  const entries = (tree ?? []).filter((entry) => only === undefined || entry.name === only)
  // Reserve all entries, including hits, before borrowing any cached objects. Eviction may remove the cache's
  // charge while this request still holds them; this reservation covers that entire lifetime through serveSkills.
  const release = await buildBudget.acquire(costOf(entries.flatMap((entry) => [...entry.files.values()]), entries.length))
  if (!release) return undefined
  try {
    const read = pool(READ_POOL)
    const skills = await drained(
      entries.map(lookup).map((entry) => (entry.hit ? Promise.resolve(entry.hit.skill) : buildSkill(entry, read))),
    )
    return { skills: skills.filter((skill) => skill !== undefined), release }
  } catch (error) {
    release()
    throw error
  }
}

/**
 * Names of the skills public hub folder `id` serves, reading only each SKILL doc; empty for any other folder or id.
 * `only` reads just the skill of that name. The other files can't leave a skill out here: `servable` already checked
 * their paths, and a binary one is left out of the skill, not the hub. The reads wait for room in `buildBudget`, and
 * name nothing when none came in time, as discovery's index then lists nothing.
 */
export async function hubSkillNames(id: string, event?: H3Event, only?: string): Promise<string[]> {
  const entries = ((await hubTree(id, event)) ?? []).filter((entry) => only === undefined || entry.name === only)
  if (!entries.length) return []
  const docs = entries.map((entry) => entry.files.get("SKILL.md")!)
  const release = await buildBudget.acquire(costOf(docs, docs.length))
  if (!release) return []
  try {
    const read = pool(READ_POOL)
    const names = await drained(
      entries.map(async (entry, index) => {
        const text = await read(() => textOf(docs[index]!))
        return text === undefined ? undefined : skillOf(entry.name, { "SKILL.md": text })?.name
      }),
    )
    return names.filter((name) => name !== undefined)
  } finally {
    release()
  }
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
 * file or an archive reads only the skill it names. When the build found no room in time, a file or an archive is a 503
 * and the index lists nothing, both with Retry-After and never cached, so the skills CLI keeps no empty list.
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
  let release: (() => void) | undefined
  let busy = false
  try {
    const response = await serveSkills(
      event.req,
      async () => {
        const result = await hubSkills(id, event, only)
        busy = !result
        release = result?.release
        return result?.skills ?? []
      },
      { base },
    )
    if (!busy || !response) return response
    const headers = new Headers(response.headers)
    headers.set("cache-control", "no-store")
    headers.set("retry-after", RETRY_AFTER)
    return rest === "index.json"
      ? new Response(response.body, { status: response.status, headers })
      : new Response(null, { status: 503, headers })
  } finally {
    release?.()
  }
}
