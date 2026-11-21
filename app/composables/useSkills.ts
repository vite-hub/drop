import type { SkillSummary } from "#shared/types"

export function useSkills() {
  const { data: skills, status, refresh } = useApi("/api/skills", { key: keys.skills, default: () => [] })
  const notify = useNotify()

  async function setEnabled(skill: Pick<SkillSummary, "name">, enabled: boolean) {
    try {
      await $fetch(`/api/skills/${skill.name}`, { method: "PATCH", body: { enabled } })
    } catch (error) {
      notify.fail(`Couldn't change ${skill.name}`, error)
    }
    await refresh()
  }

  return { skills, status, setEnabled }
}
