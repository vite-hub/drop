import type { AuthorizeReferenceAction, StripePlan } from "@better-auth/stripe"
import type { GenericEndpointContext, User } from "better-auth"
import { APIError } from "better-auth"
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import type Stripe from "stripe"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { drops, member, organization, subscription } from "../databases/config"
import type { DropRow } from "./drops/types"

// Teams on a personal Drop. A team is a Better Auth organization: its members, their roles, and invitations live there.
// What a team shares lives in its team folders (`drops.team_id`), which reach the team's members only. A team folder on a
// personal Drop works like one on a team Drop (`DROP_MODE=team`), with the team in place of everyone signed in.
//
// Billing is per team: the first `DROP_FREE_TEAM_MEMBERS` members are free, and a bigger team needs a subscription,
// one seat per member. Everyone on a team that pays gets the Pro plan, across all their drops.

/** `owner` made the team and pays for it; `admin` manages its folders and people; `member` adds to its folders. */
export type TeamRole = "owner" | "admin" | "member"
const asRole = (role: string): TeamRole => (role === "owner" || role === "admin" ? role : "member")

/**
 * Subscription states that pay for a team, the ones Stripe's plugin counts: it syncs seats, cancels, and refuses a second
 * Checkout only for these. A `past_due` or `unpaid` team is on Free until payment succeeds, and updates its card in
 * Stripe's portal (`authorizeBilling`).
 */
const PAYING = ["active", "trialing"] as const

/** Whether people may make teams here: a personal Drop with `DROP_TEAMS` on. A team Drop is one team already. */
export function teamsEnabled(event?: H3Event) {
  const { mode, teams } = useServerEnv(event).drop
  return mode !== "team" && teams
}

/** Stripe settings, when billing is on: teams enabled, and the key, the webhook secret, and the price all set. */
export function billingConfig(event?: H3Event) {
  const { billing } = useServerEnv(event).drop
  const secretKey = billing.stripeSecretKey.unseal()
  const webhookSecret = billing.stripeWebhookSecret.unseal()
  const enabled = teamsEnabled(event) && Boolean(secretKey && webhookSecret && billing.priceId)
  return {
    enabled,
    secretKey,
    webhookSecret,
    priceId: billing.priceId,
    annualPriceId: billing.annualPriceId || undefined,
    freeMembers: billing.freeMembers,
    managedPayments: billing.managedPayments,
  }
}

/**
 * The Team plan in Stripe's plugin: one price per member, billed as the plan's seat price and kept at the team's member
 * count. The plugin bills that seat price whatever the interval, so a yearly price is a plan of its own, `team-annual`.
 */
export function teamPlans({ priceId, annualPriceId }: { priceId: string; annualPriceId?: string }) {
  return [teamPlan("team", priceId), ...(annualPriceId ? [teamPlan("team-annual", annualPriceId)] : [])]
}
const teamPlan = (name: string, price: string) => ({
  name,
  priceId: price,
  seatPriceId: price,
  freeTrial: { days: 14 },
})

/**
 * What Drop adds to the plugin's Checkout Session. Managed Payments makes Stripe the merchant of record, which files sales
 * tax and VAT. Stripe then keeps the customer's name and address itself and rejects `customer_update[name]` and
 * `customer_update[address]`, which the plugin sends unless `customer_update` is set. An empty one sends nothing.
 */
export const checkoutParams = (managedPayments: boolean) => ({
  params: managedPayments ? { managed_payments: { enabled: true }, customer_update: {} } : {},
})

/** The teams someone is on, and their role on each. Empty when teams are off. */
export async function teamsOf(userId: string, event?: H3Event): Promise<Record<string, TeamRole>> {
  if (!teamsEnabled(event)) return {}
  const rows = await db
    .select({ team: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
  return Object.fromEntries(rows.map((row) => [row.team, asRole(row.role)]))
}

/** The team a node belongs to: a team folder's own, or the nearest one above it. Null outside a team, and on a team Drop. */
export function teamOf(node: Pick<DropRow, "teamFolder" | "teamId" | "ancestors">): string | null {
  if (node.teamFolder && node.teamId) return node.teamId
  return node.ancestors?.find((above) => above.teamFolder && above.teamId)?.teamId ?? null
}

/** Whether the caller is on the drop's team: anyone signed in on a team Drop, its members on a personal one. */
export function onTeam(
  team: string | null,
  who: { teams?: Record<string, TeamRole> } | null,
  teamDrop: boolean,
): boolean {
  if (!who) return false
  if (teamDrop) return true
  return team !== null && who.teams?.[team] !== undefined
}

/** Whether the caller runs the team: its owner or an admin. */
export const runsTeam = (team: string | null, who: { teams?: Record<string, TeamRole> } | null) =>
  team !== null && (who?.teams?.[team] === "owner" || who?.teams?.[team] === "admin")

/** Which teams pay now, and which need payment recovery (`past_due` while Stripe retries, `unpaid` after retries stop). */
export async function teamBilling(ids: string[]) {
  const rows = ids.length
    ? await db
        .select({ team: subscription.referenceId, status: subscription.status })
        .from(subscription)
        .where(
          and(inArray(subscription.referenceId, ids), inArray(subscription.status, [...PAYING, "past_due", "unpaid"])),
        )
    : []
  const paid = new Set(
    rows.filter((row) => row.status !== "past_due" && row.status !== "unpaid").map((row) => row.team),
  )
  const pastDue = new Set(
    rows
      .filter((row) => (row.status === "past_due" || row.status === "unpaid") && !paid.has(row.team))
      .map((row) => row.team),
  )
  return { paid, pastDue }
}

/** The teams of `ids` a subscription pays for now. */
const paidTeams = async (ids: string[]) => (await teamBilling(ids)).paid

/** Whether someone is on a team that pays: then they're on the Pro plan. */
export async function isPaying(userId: string, event?: H3Event): Promise<boolean> {
  if (!billingConfig(event).enabled) return false
  const [row] = await db.all<{ paying: number }>(sql`SELECT EXISTS (
    SELECT 1 FROM ${member} m JOIN ${subscription} s ON s.reference_id = m.organization_id
    WHERE m.user_id = ${userId} AND s.status IN (${sql.join(
      PAYING.map((status) => sql`${status}`),
      sql`, `,
    )})
  ) AS paying`)
  return Boolean(row?.paying)
}

/**
 * Whether someone may act on a team's subscription (Stripe's plugin `authorizeReference`): its owner and admins may. A
 * team whose payment failed updates its card in Stripe's portal: Checkout would start a second subscription beside it.
 */
export async function authorizeBilling({
  user,
  referenceId,
  action,
}: {
  user: { id: string }
  referenceId: string
  action: AuthorizeReferenceAction
}) {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, user.id), eq(member.organizationId, referenceId), inArray(member.role, ["owner", "admin"])),
    )
    .limit(1)
  if (!row) return false
  if (action === "upgrade-subscription" && (await teamBilling([referenceId])).pastDue.has(referenceId))
    throw new APIError("BAD_REQUEST", { message: PAST_DUE })
  return true
}
const PAST_DUE = "The team's last payment failed. Update its card in Manage billing to keep the Team plan."

/** How many people a team has, and whether it pays. */
export async function teamSeats(team: string) {
  const [row] = await db.select({ members: count() }).from(member).where(eq(member.organizationId, team))
  return { members: row?.members ?? 0, paid: (await paidTeams([team])).has(team) }
}

/**
 * The most members a team may have: unlimited when billing is off or the team pays, else the free members. Better Auth's
 * organization plugin asks this before it adds someone or sends an invitation.
 */
export async function memberLimit(team: string, event?: H3Event) {
  const billing = billingConfig(event)
  if (!billing.enabled) return Number.MAX_SAFE_INTEGER
  return (await paidTeams([team])).has(team) ? Number.MAX_SAFE_INTEGER : billing.freeMembers
}

type TeamBilling = { stripeClient: Stripe; plans: StripePlan[] }

/** Sync past-due Stripe seats before cleanup, returning the subscriptions whose local seats must follow on success. */
async function syncPastDueSeats(team: string, members: number, billing?: TeamBilling) {
  const synced: string[] = []
  if (!billing) return synced
  const rows = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, team), eq(subscription.status, "past_due")))
  for (const row of rows) {
    const plan = billing.plans.find((entry) => entry.name.toLowerCase() === row.plan)
    if (!row.stripeSubscriptionId || !plan?.seatPriceId) continue
    const live = await billing.stripeClient.subscriptions.retrieve(row.stripeSubscriptionId)
    // Past-due teams are on Free, but their existing subscription still needs the current seat count on recovery.
    if (live.status !== "past_due" && !PAYING.some((status) => status === live.status)) continue
    const item = live.items.data.find((entry) => entry.price.id === plan.seatPriceId)
    if (item?.quantity !== members)
      await billing.stripeClient.subscriptions.update(live.id, {
        items: [item ? { id: item.id, quantity: members } : { price: plan.seatPriceId, quantity: members }],
        proration_behavior: plan.prorationBehavior ?? "create_prorations",
      })
    synced.push(row.id)
  }
  return synced
}

/**
 * Takes someone off their teams before Better Auth deletes their account (its `user.delete.before` hook). Each team runs
 * the organization plugin's hooks as if they had been removed, with past-due Stripe seats synced before any cleanup so
 * a Stripe failure leaves all their teams intact. Better Auth Stripe 1.7 itself only syncs active/trialing seats. A team
 * they own passes to its oldest admin, or to its oldest member when it has no admin. A team with nobody else on it is deleted
 * with its invitations and content. Stripe's plugin refuses that while the team still pays, and then the account stays
 * until someone cancels the subscription.
 */
export async function leaveTeams(user: User, context: GenericEndpointContext | null, billing?: TeamBilling) {
  const hooks = context?.context.getPlugin("organization")?.options.organizationHooks ?? {}
  const teams = await db
    .select({ membership: member, team: organization })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, user.id))
  const left = []
  for (const { membership, team } of teams) {
    const others = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, team.id), ne(member.userId, user.id)))
      .orderBy(asc(member.createdAt), asc(member.id))
    if (!others.length) await hooks.beforeDeleteOrganization?.({ organization: team, user })
    left.push({ membership, team, others })
  }
  // Finish every fallible past-due Stripe call before changing any membership, ownership, local seat count or content.
  const seats = []
  for (const { team, others } of left) {
    if (!others.length) continue
    const synced = await syncPastDueSeats(team.id, others.length, billing)
    seats.push(...synced.map((id) => ({ id, members: others.length })))
  }
  for (const { membership, team, others } of left) {
    if (!others.length) {
      const { deleteDrop } = await import("./drops/lifecycle")
      const folders = await db.select().from(drops).where(eq(drops.teamId, team.id))
      const gone = new Set<string>()
      for (const folder of folders) if (!gone.has(folder.id)) await deleteDrop(folder, gone)
      await db.delete(organization).where(eq(organization.id, team.id))
      continue
    }
    const heir = others.find((other) => asRole(other.role) === "admin") ?? others[0]!
    if (asRole(membership.role) === "owner" && !others.some((other) => asRole(other.role) === "owner"))
      await db.update(member).set({ role: "owner" }).where(eq(member.id, heir.id))
    await db.delete(member).where(eq(member.id, membership.id))
    await hooks.afterRemoveMember?.({ member: membership, user, organization: team })
  }
  for (const { id, members } of seats)
    await db.update(subscription).set({ seats: members }).where(eq(subscription.id, id))
}
