// Teams on a personal Drop (server/utils/teams.ts), through Better Auth's organization and Stripe plugins. Each call
// answers with `{ data, error }`; these turn an error into a thrown one so callers notify like any other request.
type Result<T> = { data: T | null; error: { message?: string; statusText?: string } | null }

async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error } = await call
  if (error || data === null) throw new Error(error?.message || error?.statusText || "Something went wrong.")
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

/** The link someone opens to join: Drop sends no email, so whoever invites shares it. */
export const inviteLink = (id: string) => `${useRequestURL().origin}/teams/join/${id}`

const reload = () => refreshNuxtData([keys.me, keys.sharedWithMe])

/** One of the team's folders, which its owner and admins make. */
async function addFolder(id: string, folder: { title: string; description?: string }) {
  await $fetch("/api/folders", { method: "POST", body: { ...folder, teamId: id } })
  await refreshNuxtData(keys.sharedWithMe)
}

export function useTeams() {
  const { $auth } = useNuxtApp()

  /** Makes a team and its first folder, named after it, where its drops go. */
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

  /** Stripe Checkout for the Team plan, one seat per member; Stripe sends them back to the team's page. */
  const upgrade = (id: string, annual = false) =>
    unwrap(
      $auth.subscription.upgrade({
        plan: "team",
        annual,
        referenceId: id,
        customerType: "organization",
        successUrl: `/teams/${id}?billing=done`,
        cancelUrl: `/teams/${id}`,
      }),
    )

  /** Stripe's portal: card, invoices, cancel. */
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
