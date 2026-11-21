import { defineHandler } from "h3"
import type { SkillSummary } from "#shared/types"
import { requireIdentity } from "../../utils/identity"
import settings from "../../skills"
import { sourceOf } from "../../utils/skills"

export default defineHandler(async (event): Promise<SkillSummary[]> => {
  const who = await requireIdentity(event)
  const [error, states] = await settings.list()
  if (error) throw error
  return states
    .filter(({ enabled }) => who.role === "admin" || enabled)
    .map(({ skill, enabled }) => ({
      name: skill.name,
      description: skill.description,
      enabled,
      source: sourceOf(skill),
    }))
})
