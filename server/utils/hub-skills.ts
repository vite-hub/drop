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

type Row = typeof drops.$inferSelect

interface HubEntry {
  name: string
  files: Map<string, { id: string; version: number; blobKey: string; size: number; text: boolean }>
}

const SKILL_SLUG = "skill"

export const MAX_SKILL_FILES = 200
export const MAX_SKILL_BYTES = 2 * MAX_FILE_BYTES
const MAX_HUB_BYTES = MAX_SKILL_BYTES
export const MAX_HUB_SKILLS = 100
export const MAX_HUB_FILES = 2000
export const MAX_FRONTMATTER = 4 * 1024
const READ_POOL = 6

const segmentOf = (row: Row) => row.slug ?? slugify(row.title)

const fileName = (name: string) => (name && name !== "." && name !== ".." && !/[/\\\0]/.test(name) ? name : undefined)

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
    const at = ancestors.findIndex((node) => node.id === hub.id)
    if (at === -1) continue
    const node = await currentReview(
      { ...resolveNode(drop, ancestors, days), ownerBanned: !owner || Boolean(owner.banned) },
      owner,
      event,
    )
    if (!permissions(node, null).view) continue
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

const PROBE = "---\nname: probe\ndescription: Checks the paths of a hub skill.\n---\n"

function archivable(paths: Iterable<string>) {
  try {
    defineSkill({ ...Object.fromEntries([...paths].map((path) => [path, ""])), "SKILL.md": PROBE })
    return true
  } catch {
    return false
  }
}

const bytesOf = (entry: HubEntry) => [...entry.files.values()].reduce((sum, file) => sum + file.size, 0)

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

async function drained<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks)
  const failed = results.find((result) => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
  // SAFETY: all tasks have settled, and any rejected result above throws before this fulfilled-only mapping.
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

const built = new Map<string, { at: number; bytes: number; skill: Skill | undefined }>()
export const BUILT_BYTES = 36 * 1024 * 1024
export const BUILDING_BYTES = 60 * 1024 * 1024
const BUILT_TTL = 5 * 60_000
const FILE_OVERHEAD = 512
const FILE_COST = 3 * 1024
const ENTRY_OVERHEAD = 1024
const YAML_BYTES = 32
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

const frontmatterOf = (text: string) => FRONTMATTER.exec(text.replace(/^\uFEFF/, ""))?.[1]

const costOf = (files: { size: number }[], skills: number) =>
  files.reduce((sum, file) => sum + 5 * file.size + FILE_COST, 0) + skills * MAX_FRONTMATTER * YAML_BYTES

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

export const buildBudget = budget(BUILDING_BYTES, 10_000)
const RETRY_AFTER = "10"

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

export const builtSkills = () => [...built].map(([key, { bytes, skill }]) => ({ key, bytes, skill }))

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

function skillOf(name: string, files: Record<string, string>): Skill | undefined {
  const frontmatter = files["SKILL.md"] === undefined ? undefined : frontmatterOf(files["SKILL.md"])
  if (frontmatter === undefined || frontmatter.length > MAX_FRONTMATTER) return undefined
  try {
    const skill = defineSkill(files)
    return skill.name === name ? skill : undefined
  } catch {
    return undefined
  }
}

async function textOf(file: { blobKey: string; text: boolean }) {
  if (file.text) return readText(file.blobKey)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(file.blobKey))
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

async function hubSkills(id: string, event?: H3Event, only?: string) {
  const tree = await hubTree(id, event)
  const entries = (tree ?? []).filter((entry) => only === undefined || entry.name === only)
  const release = await buildBudget.acquire(
    costOf(
      entries.flatMap((entry) => [...entry.files.values()]),
      entries.length,
    ),
  )
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
