import { eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { defineSkill, defineSkills, type Skill } from "vite-hub/skills"
import comarkUiSkill from "comark-ui/skills/comark-ui/SKILL.md?raw"
import { skills as comarkSkills } from "comark-ui/skills"
import prEvidenceMd from "../../skills/pr-evidence/SKILL.md?raw"
import prEvidenceReview from "../../skills/pr-evidence/references/review.md?raw"
import { skillSettings } from "../databases/default/index"

const localFiles = import.meta.glob<string>(["../../skills/**", "!../../skills/pr-evidence/**"], {
  query: "?raw",
  import: "default",
  eager: true,
})

const comarkUiReferences = import.meta.glob<string>(
  "../../node_modules/comark-ui/dist/skills/comark-ui/references/*.md",
  { query: "?raw", import: "default", eager: true },
)
const prEvidence = defineSkill({
  "SKILL.md": prEvidenceMd,
  "references/review.md": prEvidenceReview,
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

const LOCAL_SKILLS = [...defineSkills(localFiles), prEvidence].sort(
  (a, b) => Number(b.name === "vitehub-drop") - Number(a.name === "vitehub-drop") || a.name.localeCompare(b.name),
)

const COMARK_SKILLS = "https://comark-ui.onmax.me/.well-known/skills/"
const BUNDLED_SKILLS = comarkSkills
  .filter((entry) => !LOCAL_SKILLS.some((local) => local.name === entry.name))
  .map((entry) => defineSkill(Object.fromEntries(entry.files.map((file) => [file.path, file.text]))))

export const SKILLS: Skill[] = [...LOCAL_SKILLS, ...BUNDLED_SKILLS]

export const sourceOf = (skill: Skill) =>
  BUNDLED_SKILLS.includes(skill)
    ? `${COMARK_SKILLS}${skill.name}/SKILL.md`
    : `https://github.com/vite-hub/drop/blob/main/skills/${skill.name}/SKILL.md`

export const findSkill = (name: string) => SKILLS.find((item) => item.name === name)

const SETTINGS_TTL_MS = 60_000
let settings: { at: number; disabled: Promise<Set<string>> } | undefined

export function disabledSkills(): Promise<Set<string>> {
  if (settings && Date.now() - settings.at < SETTINGS_TTL_MS) return settings.disabled
  const disabled = db
    .select({ name: skillSettings.name })
    .from(skillSettings)
    .where(eq(skillSettings.enabled, false))
    .then((rows) => new Set(rows.map((row) => row.name)))
  disabled.catch(() => (settings = undefined))
  settings = { at: Date.now(), disabled }
  return disabled
}

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
