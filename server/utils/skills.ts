import { parseYAML } from "confbox/yaml"
import { eq } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { createTarGzip } from "nanotar"
import annotateSkill from "comark-annotate/skills/comark-annotate/SKILL.md?raw"
import { version as annotateVersion } from "comark-annotate/package.json"
import { skillSettings } from "../databases/config"
import handoffMd from "../../skills/handoff/SKILL.md?raw"
import prEvidenceMd from "../../skills/pr-evidence/SKILL.md?raw"
import prototypePicker from "../../skills/prototype/assets/picker.js?raw"
import prototypeCanvas from "../../skills/prototype/references/canvas.md?raw"
import prototypeMd from "../../skills/prototype/SKILL.md?raw"
import showMeMd from "../../skills/show-me/SKILL.md?raw"
import boardGuide from "../../skills/vitehub-drop/references/board.md?raw"
import documentsGuide from "../../skills/vitehub-drop/references/documents.md?raw"
import markdownGuide from "../../skills/vitehub-drop/references/markdown.md?raw"
import dropMd from "../../skills/vitehub-drop/SKILL.md?raw"

// Slidev's own skill, copied from slidevjs/slidev by scripts/sync-slidev-skill.mjs: its SKILL.md and every reference.
const slidevFiles = import.meta.glob<string>("../../skills/slidev/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

/**
 * Drop's built-in Agent Skills, defined once (the files under skills/) and served three ways. `slidev` is Slidev's own,
 * copied as it is, so vitehub-drop can send deck work there:
 * - MCP: the Skills extension (SEP-2640), as `skill://` resources (server/mcp, server/utils/mcp-skills.ts)
 * - Agent Skills Discovery v0.2.0 at /.well-known/agent-skills/ (index with digests, archive for multi-file skills)
 * - Discovery v0.1.0 at /.well-known/skills/, which `npx skills add` still reads
 *
 * Admins switch them on and off for the whole deployment (`skill_settings`); every surface serves only the enabled set.
 */
export interface SkillFile {
  path: string
  text: string
  bytes: Uint8Array<ArrayBuffer>
  mimeType: string
}
export interface Skill {
  name: string
  description: string
  frontmatter: Record<string, unknown>
  files: SkillFile[]
}

const encoder = new TextEncoder()
const file = (path: string, text: string): SkillFile => ({
  path,
  text,
  bytes: encoder.encode(text),
  mimeType: path.endsWith(".js") ? "text/javascript" : "text/markdown",
})

function frontmatterOf(markdown: string): Record<string, unknown> {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  return block ? (parseYAML<Record<string, unknown>>(block) ?? {}) : {}
}

function skill(files: SkillFile[]): Skill {
  const frontmatter = frontmatterOf(files.find((item) => item.path === "SKILL.md")!.text)
  return { name: String(frontmatter.name), description: String(frontmatter.description), frontmatter, files }
}

// pr-evidence's annotation reference is comark-annotate's own skill, from the version Drop renders with, so it never
// describes syntax Drop can't draw. Its CLI commands get the same version, since a bare npx would run the latest.
const prEvidenceAnnotations = annotateSkill
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "")
  .replaceAll("npx comark-annotate ", `npx comark-annotate@${annotateVersion} `)

/** Every built-in skill, enabled or not. Only the admin UI should see the disabled ones. */
export const SKILLS: Skill[] = [
  skill([
    file("SKILL.md", dropMd),
    file("references/documents.md", documentsGuide),
    file("references/markdown.md", markdownGuide),
    file("references/board.md", boardGuide),
  ]),
  skill([file("SKILL.md", handoffMd)]),
  skill([file("SKILL.md", prEvidenceMd), file("references/annotations.md", prEvidenceAnnotations)]),
  skill([
    file("SKILL.md", prototypeMd),
    file("assets/picker.js", prototypePicker),
    file("references/canvas.md", prototypeCanvas),
  ]),
  skill([file("SKILL.md", showMeMd)]),
  skill(
    Object.entries(slidevFiles)
      .map(([path, text]) => file(path.replace("../../skills/slidev/", ""), text))
      .sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || a.path.localeCompare(b.path)),
  ),
]

export const findSkill = (name: string) => SKILLS.find((item) => item.name === name)

// A toggle shows up on this isolate at once; other isolates pick it up within a minute, the same window as the
// MCP and discovery cache hints.
const SETTINGS_TTL_MS = 60_000
let settings: { at: number; disabled: Promise<Set<string>> } | undefined

/** Names an admin switched off. A skill without a row is enabled. */
export function disabledSkills(): Promise<Set<string>> {
  if (settings && Date.now() - settings.at < SETTINGS_TTL_MS) return settings.disabled
  const disabled = db
    .select({ name: skillSettings.name })
    .from(skillSettings)
    .where(eq(skillSettings.enabled, false))
    .then((rows) => new Set(rows.map((row) => row.name)))
  // A failed read must not stick for a minute: drop it so the next request tries again.
  disabled.catch(() => (settings = undefined))
  settings = { at: Date.now(), disabled }
  return disabled
}

export async function enabledSkills(): Promise<Skill[]> {
  const disabled = await disabledSkills()
  return SKILLS.filter((item) => !disabled.has(item.name))
}

export async function findEnabledSkill(name: string): Promise<Skill | undefined> {
  const found = findSkill(name)
  return found && !(await disabledSkills()).has(found.name) ? found : undefined
}

export async function setSkillEnabled(name: string, enabled: boolean, userId: string) {
  await db
    .insert(skillSettings)
    .values({ name, enabled, updatedAt: Date.now(), updatedBy: userId })
    .onConflictDoUpdate({ target: skillSettings.name, set: { enabled, updatedAt: Date.now(), updatedBy: userId } })
  settings = undefined
}

/** `sha256:<hex>`, the digest format both the MCP Skills extension and Discovery v0.2.0 use. */
export async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

/**
 * A multi-file skill as one .tar.gz (Discovery v0.2.0 `archive`): the skill directory itself, `SKILL.md` at the
 * archive's root with no wrapper folder, as the spec asks. Fixed mtimes keep the bytes, and so the digest, the same
 * on every isolate; built once per isolate.
 */
const archives = new Map<string, Promise<Uint8Array<ArrayBuffer>>>()
export function skillArchive(item: Skill) {
  let archive = archives.get(item.name)
  if (!archive) {
    // Copied once into a plain ArrayBuffer, which Response and crypto.subtle take.
    archive = createTarGzip(
      item.files.map((entry) => ({ name: entry.path, data: entry.bytes, attrs: { mtime: 0, mode: "644" } })),
    ).then((bytes) => new Uint8Array(bytes))
    archives.set(item.name, archive)
  }
  return archive
}
