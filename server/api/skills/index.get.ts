import { defineHandler } from "h3"
import type { SkillSummary } from "#shared/types"
import { requireIdentity } from "../../utils/identity"
import { disabledSkills, SKILLS } from "../../utils/skills"

/** The skills catalog: what agents get over MCP. Admins also see the ones they switched off. */
export default defineHandler(async (event): Promise<SkillSummary[]> => {
  const who = await requireIdentity(event)
  const disabled = await disabledSkills()
  return SKILLS
    .filter(skill => who.role === "admin" || !disabled.has(skill.name))
    .map(skill => ({
      name: skill.name,
      description: skill.description,
      enabled: !disabled.has(skill.name),
      uri: `skill://${skill.name}/SKILL.md`,
      files: skill.files.length,
    }))
})
