import type { Member } from "#shared/types"

/** Who's in this Drop, and the admin actions on them. */
export function useMembers() {
  const { data: members, status } = useApi("/api/members", { key: "members", default: () => [] })
  const notify = useNotify()
  const confirm = useConfirm()
  const reload = () => refreshNuxtData(["members", "me"])

  async function update(member: Member, body: { banned: boolean }, title: string, description?: string) {
    try {
      await $fetch(`/api/members/${member.id}`, { method: "PATCH", body })
      notify.done(title, description)
    }
    catch (error) {
      notify.fail(`Couldn't update ${member.name}`, error)
    }
    await reload()
  }

  return {
    members,
    status,
    ban: (member: Member) => update(member, { banned: true }, `${member.name} is banned`, "Their sessions and connected agents stop working."),
    unban: (member: Member) => update(member, { banned: false }, `${member.name} can sign in again`),
    async remove(member: Member) {
      if (!await confirm({ title: `Remove ${member.name}?`, description: "They lose access. Their drops stay in the workspace.", confirmLabel: "Remove", destructive: true })) return
      try {
        await $fetch(`/api/members/${member.id}`, { method: "DELETE" })
        notify.done(`${member.name} removed`, "Their drops stay in the workspace.")
      }
      catch (error) {
        notify.fail(`Couldn't remove ${member.name}`, error)
      }
      await reload()
    },
  }
}
