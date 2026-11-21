import { defineHandler } from "h3"
import type { SkillSummary } from "#shared/types"
import { requireIdentity } from "../../utils/identity"
import { disabledSkills, SKILLS, sourceOf } from "../../utils/skills"

export default defineHandler(async (event): Promise<SkillSummary[]> => {
  const who = await requireIdentity(event)
  const disabled = await disabledSkills()
  return SKILLS.filter((skill) => who.role === "admin" || !disabled.has(skill.name)).map((skill) => ({
    name: skill.name,
    description: skill.description,
    enabled: !disabled.has(skill.name),
    source: sourceOf(skill),
  }))
})
