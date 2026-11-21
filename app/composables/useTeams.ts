type Result<T> = { data: T | null; error: { message?: string; statusText?: string; status: number } | null }

async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error } = await call
  if (error) throw answerError(error.message || error.statusText || "Something went wrong.", error.status)
  if (data === null) throw new Error("Something went wrong.")
  return data
}

const slugOf = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "team"
  }-${crypto.randomUUID().slice(0, 6)}`

export const inviteLink = (id: string) => `${useRequestURL().origin}/teams/join/${id}`

const reload = () => refreshNuxtData([keys.me, keys.sharedWithMe, keys.pinned])

async function addFolder(id: string, folder: { title: string; description?: string }) {
  await $fetch("/api/folders", { method: "POST", body: { ...folder, teamId: id } })
  await refreshNuxtData(keys.sharedWithMe)
}

export function useTeams() {
  const { $auth } = useNuxtApp()

  async function create(name: string) {
    const team = await unwrap(
      $auth.organization.create({ name, slug: slugOf(name), keepCurrentActiveOrganization: true }),
    )
    await reload()
    await addFolder(team.id, { title: name, description: `What ${name} shares. Agents publish the team's drops here.` })
    return team
  }

  const full = (id: string) => unwrap($auth.organization.getFullOrganization({ query: { organizationId: id } }))

  const invite = (id: string, email: string, role: "member" | "admin") =>
    unwrap($auth.organization.inviteMember({ organizationId: id, email, role }))

  const cancelInvite = (invitationId: string) => unwrap($auth.organization.cancelInvitation({ invitationId }))

  const invitation = (id: string) => unwrap($auth.organization.getInvitation({ query: { id } }))

  async function accept(invitationId: string) {
    const joined = await unwrap($auth.organization.acceptInvitation({ invitationId }))
    await reload()
    return joined
  }

  async function removeMember(id: string, memberIdOrEmail: string) {
    await unwrap($auth.organization.removeMember({ organizationId: id, memberIdOrEmail }))
    await reload()
  }

  const setRole = (id: string, memberId: string, role: "member" | "admin") =>
    unwrap($auth.organization.updateMemberRole({ organizationId: id, memberId, role }))

  async function leave(id: string) {
    await unwrap($auth.organization.leave({ organizationId: id }))
    await reload()
  }

  const upgrade = async (id: string, annual = false) => {
    const team = await full(id)
    const seats = team.members.length
    return unwrap(
      $auth.subscription.upgrade({
        plan: annual ? "team-annual" : "team",
        referenceId: id,
        customerType: "organization",
        seats,
        successUrl: `/teams/${id}?billing=done`,
        cancelUrl: `/teams/${id}`,
      }),
    )
  }

  const manageBilling = (id: string) =>
    unwrap(
      $auth.subscription.billingPortal({
        referenceId: id,
        customerType: "organization",
        returnUrl: `/teams/${id}`,
      }),
    )

  return {
    create,
    addFolder,
    full,
    invite,
    cancelInvite,
    invitation,
    accept,
    removeMember,
    setRole,
    leave,
    upgrade,
    manageBilling,
  }
}
