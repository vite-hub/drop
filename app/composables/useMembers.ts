import type { Tier } from "#shared/quotas"
import type { Member } from "#shared/types"

/** Everyone in this Drop. Any signed-in person may list them: the Members page, and "@" in the editor. */
export const useMemberList = () => useApi("/api/members", { key: keys.members, default: () => [] })

const reload = () => refreshNuxtData([keys.members, keys.me])

/** Who's in this Drop, and the admin actions on them. */
export function useMembers() {
  const { data: members, status } = useMemberList()
  const notify = useNotify()
  const confirm = useConfirm()

  async function update(member: Member, body: { banned?: boolean; plan?: Tier }, title: string, description?: string) {
    try {
      await $fetch(`/api/members/${member.id}`, { method: "PATCH", body })
      notify.done(title, description)
    } catch (error) {
      notify.fail(`Couldn't update ${member.name}`, error)
    }
    await reload()
  }

  return {
    members,
    status,
    ban: (member: Member) =>
      update(member, { banned: true }, `${member.name} is banned`, "Their sessions and connected agents stop working."),
    unban: (member: Member) => update(member, { banned: false }, `${member.name} can sign in again`),
    setPlan: (member: Member, plan: Tier) =>
      plan !== member.plan && update(member, { plan }, `${member.name} is on ${PLAN_LABELS[plan]}`),
    async remove(member: Member) {
      if (
        !(await confirm({
          title: `Remove ${member.name}?`,
          description: "They lose access. Their drops stay in the workspace.",
          confirmLabel: "Remove",
          destructive: true,
        }))
      )
        return
      try {
        await $fetch(`/api/members/${member.id}`, { method: "DELETE" })
        notify.done(`${member.name} removed`, "Their drops stay in the workspace.")
      } catch (error) {
        notify.fail(`Couldn't remove ${member.name}`, error)
      }
      await reload()
    },
  }
}
