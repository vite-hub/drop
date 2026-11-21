import { defineSkill, defineSkills, type Skill } from "vite-hub/skills"
import comarkUiSkill from "comark-ui/skills/comark-ui/SKILL.md?raw"
import { skills as comarkSkills } from "comark-ui/skills"
import prEvidenceMd from "../../skills/pr-evidence/SKILL.md?raw"
import prEvidenceReview from "../../skills/pr-evidence/references/review.md?raw"

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
