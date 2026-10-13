import type { SkillSummary } from "#shared/types"

/** The Agent Skills catalog, and the admin switch that turns a skill on or off for everyone. */
export function useSkills() {
  const { data: skills, status, refresh } = useApi("/api/skills", { key: "skills", default: () => [] })
  const notify = useNotify()

  async function setEnabled(skill: Pick<SkillSummary, "name">, enabled: boolean) {
    try {
      await $fetch(`/api/skills/${skill.name}`, { method: "PATCH", body: { enabled } })
      notify.done(enabled ? `${skill.name} is on` : `${skill.name} is off`, enabled ? "Agents get it over MCP." : "Agents stop getting it within a minute.")
    }
    catch (error) {
      notify.fail(`Couldn't change ${skill.name}`, error)
    }
    await refresh()
  }

  return { skills, status, setEnabled }
}
