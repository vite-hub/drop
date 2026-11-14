import { eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { defineSkill, defineSkills, type Skill } from "vite-hub/skills"
import comarkUiSkill from "comark-ui/skills/comark-ui/SKILL.md?raw"
import { skills as comarkSkills } from "comark-ui/skills"
import prEvidenceMd from "../../skills/pr-evidence/SKILL.md?raw"
import { skillSettings } from "../databases/default/index"

/**
 * Drop's local and bundled upstream Agent Skills. `vite-hub/skills` serves them three ways: MCP (the Skills extension,
 * server/mcp), Agent Skills Discovery v0.2.0 at /.well-known/agent-skills/, and v0.1.0 at /.well-known/skills/, which
 * `npx skills add` reads (server/middleware/0.3.well-known.ts). `slidev` is Slidev's own, copied as it is by
 * scripts/sync-slidev-skill.mjs, so vitehub-drop can send deck work there.
 *
 * Admins switch them on and off for the whole deployment (`skill_settings`); every surface serves only `enabledSkills`.
 */
// pr-evidence is built on its own below: its bundled comark-ui/SKILL.md would otherwise start a nested skill.
const localFiles = import.meta.glob<string>(["../../skills/**", "!../../skills/pr-evidence/**"], {
  query: "?raw",
  import: "default",
  eager: true,
})

// pr-evidence bundles the renderer package's skill and references, keeping their relative links intact. Its
// references/annotations.md stays the entry point to the complete comark-ui guide.
const comarkUiReferences = import.meta.glob<string>(
  "../../node_modules/comark-ui/dist/skills/comark-ui/references/*.md",
  { query: "?raw", import: "default", eager: true },
)
const prEvidence = defineSkill({
  "SKILL.md": prEvidenceMd,
  "references/annotations.md": comarkUiSkill
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "")
    .replaceAll("](references/", "](comark-ui/references/"),
  "references/comark-ui/SKILL.md": comarkUiSkill,
  ...Object.fromEntries(
    Object.entries(comarkUiReferences).map(([path, text]) => [
      path.replace("../../node_modules/comark-ui/dist/skills/", "references/"),
      text,
    ]),
  ),
})

// vitehub-drop, Drop's own skill, comes first in every list; the others follow by name.
const LOCAL_SKILLS = [...defineSkills(localFiles), prEvidence].sort(
  (a, b) => Number(b.name === "vitehub-drop") - Number(a.name === "vitehub-drop") || a.name.localeCompare(b.name),
)

// comark-ui's own skills, from the installed release, so they describe the renderer Drop runs. Their source links
// point at comark-ui's skill index, which serves the same files.
const COMARK_SKILLS = "https://comark-ui.onmax.me/.well-known/skills/"
const BUNDLED_SKILLS = comarkSkills
  .filter((entry) => !LOCAL_SKILLS.some((local) => local.name === entry.name))
  .map((entry) => defineSkill(Object.fromEntries(entry.files.map((file) => [file.path, file.text]))))

/** Every built-in skill, enabled or not. Only the admin UI should see the disabled ones. */
export const SKILLS: Skill[] = [...LOCAL_SKILLS, ...BUNDLED_SKILLS]

/** Where a skill's source lives, for the catalog. */
export const sourceOf = (skill: Skill) =>
  BUNDLED_SKILLS.includes(skill)
    ? `${COMARK_SKILLS}${skill.name}/SKILL.md`
    : `https://github.com/vite-hub/drop/blob/main/skills/${skill.name}/SKILL.md`

export const findSkill = (name: string) => SKILLS.find((item) => item.name === name)

// A toggle shows up on this isolate at once; other isolates pick it up within a minute, the same window as the
// discovery cache hint.
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

/** The skills every surface serves: the list function `serveSkills` and `skillsMcp` read on each request. */
export async function enabledSkills(): Promise<Skill[]> {
  const disabled = await disabledSkills()
  return SKILLS.filter((item) => !disabled.has(item.name))
}

export async function setSkillEnabled(name: string, enabled: boolean, userId: string) {
  await db
    .insert(skillSettings)
    .values({ name, enabled, updatedAt: Date.now(), updatedBy: userId })
    .onConflictDoUpdate({ target: skillSettings.name, set: { enabled, updatedAt: Date.now(), updatedBy: userId } })
  settings = undefined
}
