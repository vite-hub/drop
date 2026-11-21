import type { AuthorizeReferenceAction, StripePlan } from "@better-auth/stripe"
import type { GenericEndpointContext, User } from "better-auth"
import type { OrganizationOptions } from "better-auth/plugins"
import { APIError } from "better-auth"
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { H3Event } from "h3"
import type Stripe from "stripe"
import { db } from "vite-hub/database"
import { useServerEnv } from "vite-hub/env"
import { drops, member, organization, subscription } from "../databases/default/index"
import type { DropRow } from "./drops/types"
import { authRequest, logAudit, requestLog } from "./logs"

export type TeamRole = "owner" | "admin" | "member"
const asRole = (role: string): TeamRole => (role === "owner" || role === "admin" ? role : "member")

const PAYING = ["active", "trialing"] as const

export function teamsEnabled(event?: H3Event) {
  const { mode, teams } = useServerEnv(event).drop
  return mode !== "team" && teams
}

export function billingConfig(event?: H3Event) {
  const { billing } = useServerEnv(event).drop
  const secretKey = billing.stripeSecretKey?.unseal() ?? ""
  const webhookSecret = billing.stripeWebhookSecret?.unseal() ?? ""
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

export function teamPlans({ priceId, annualPriceId }: { priceId: string; annualPriceId?: string }) {
  return [teamPlan("team", priceId), ...(annualPriceId ? [teamPlan("team-annual", annualPriceId)] : [])]
}
const teamPlan = (name: string, price: string) => ({
  name,
  priceId: price,
  seatPriceId: price,
  freeTrial: { days: 14 },
})

export const checkoutParams = (managedPayments: boolean) => ({
  params: managedPayments ? { managed_payments: { enabled: true }, customer_update: {} } : {},
})

export async function teamsOf(userId: string, event?: H3Event): Promise<Record<string, TeamRole>> {
  if (!teamsEnabled(event)) return {}
  const rows = await db
    .select({ team: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
  return Object.fromEntries(rows.map((row) => [row.team, asRole(row.role)]))
}

export function teamOf(node: Pick<DropRow, "teamFolder" | "teamId" | "ancestors">): string | null {
  if (node.teamFolder && node.teamId) return node.teamId
  return node.ancestors?.find((above) => above.teamFolder && above.teamId)?.teamId ?? null
}

export function onTeam(
  team: string | null,
  who: { teams?: Record<string, TeamRole> } | null,
  teamDrop: boolean,
): boolean {
  if (!who) return false
  if (teamDrop) return true
  return team !== null && who.teams?.[team] !== undefined
}

export const runsTeam = (team: string | null, who: { teams?: Record<string, TeamRole> } | null) =>
  team !== null && (who?.teams?.[team] === "owner" || who?.teams?.[team] === "admin")

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

const paidTeams = async (ids: string[]) => (await teamBilling(ids)).paid

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

async function teamSeats(team: string) {
  const [row] = await db.select({ members: count() }).from(member).where(eq(member.organizationId, team))
  return { members: row?.members ?? 0, paid: (await paidTeams([team])).has(team) }
}

export async function memberLimit(team: string, event?: H3Event) {
  const billing = billingConfig(event)
  if (!billing.enabled) return Number.MAX_SAFE_INTEGER
  return (await paidTeams([team])).has(team) ? Number.MAX_SAFE_INTEGER : billing.freeMembers
}

type TeamBilling = { stripeClient: Stripe; plans: StripePlan[] }
type SeatChange = {
  id: string
  members: number
  apply?: () => Promise<unknown>
  restore: () => Promise<void>
}

async function pastDueSeatChanges(team: string, members: number, billing?: TeamBilling) {
  const changes: SeatChange[] = []
  if (!billing) return changes
  const rows = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, team), eq(subscription.status, "past_due")))
  for (const row of rows) {
    const plan = billing.plans.find((entry) => entry.name.toLowerCase() === row.plan)
    if (!row.stripeSubscriptionId || !plan?.seatPriceId) continue
    const live = await billing.stripeClient.subscriptions.retrieve(row.stripeSubscriptionId)
    if (live.status !== "past_due" && !PAYING.some((status) => status === live.status)) continue
    const item = live.items.data.find((entry) => entry.price.id === plan.seatPriceId)
    const previous = item ? { id: item.id, quantity: item.quantity ?? 1 } : undefined
    const proration = {
      proration_behavior: plan.prorationBehavior ?? "create_prorations",
      proration_date: Math.floor(Date.now() / 1000),
    }
    changes.push({
      id: row.id,
      members,
      apply:
        item?.quantity === members
          ? undefined
          : () =>
              billing.stripeClient.subscriptions.update(live.id, {
                items: [item ? { id: item.id, quantity: members } : { price: plan.seatPriceId, quantity: members }],
                ...proration,
              }),
      restore: async () => {
        const current = await billing.stripeClient.subscriptions.retrieve(live.id)
        const seat = current.items.data.find((entry) => entry.price.id === plan.seatPriceId)
        if (previous ? seat?.quantity === previous.quantity : !seat) return
        await billing.stripeClient.subscriptions.update(live.id, {
          items: [previous ?? { id: seat!.id, deleted: true }],
          ...proration,
        })
      },
    })
  }
  return changes
}

async function holdMemberLimit(team: string) {
  const limit = await memberLimit(team)
  await db
    .update(organization)
    .set({ memberLimit: limit === Number.MAX_SAFE_INTEGER ? null : limit })
    .where(eq(organization.id, team))
  return limit
}

interface BilledSubscription {
  id: string
  referenceId: string
  plan: string
  status?: string | null
  seats?: number | null
}

export const logSubscription = (change: string) => async (data: { subscription: BilledSubscription }) => {
  const event = authRequest.getStore()
  const { id, referenceId: team, plan, status, seats } = data.subscription
  requestLog(event)?.set({ stripe: { subscription: { id, team, plan, status, seats, changes: [change] } } })
  if (!event || event.context.billingAudited) return
  event.context.billingAudited = true
  logAudit(event, "stripe", `billing.${change}`, { type: "team", id: team })
}

export const teamOptions = {
  creatorRole: "owner",
  invitationExpiresIn: 7 * 24 * 60 * 60,
  cancelPendingInvitationsOnReInvite: true,
  membershipLimit: (_user, team) => holdMemberLimit(team.id),
  invitationLimit: async ({ organization: team }) =>
    Math.max(0, (await holdMemberLimit(team.id)) - (await teamSeats(team.id)).members),
} satisfies OrganizationOptions

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
  const seats: SeatChange[] = []
  for (const { team, others } of left) {
    if (!others.length) continue
    seats.push(...(await pastDueSeatChanges(team.id, others.length, billing)))
  }
  const attempted: SeatChange[] = []
  try {
    for (const seat of seats) {
      if (!seat.apply) continue
      attempted.push(seat)
      await seat.apply()
    }
    const changes: BatchItem<"sqlite">[] = []
    for (const { membership, team, others } of left) {
      if (!others.length) {
        const { deleteDrop } = await import("./drops/lifecycle")
        const folders = await db.select().from(drops).where(eq(drops.teamId, team.id))
        const gone = new Set<string>()
        for (const folder of folders) if (!gone.has(folder.id)) await deleteDrop(folder, gone)
        changes.push(db.delete(organization).where(eq(organization.id, team.id)))
        continue
      }
      const heir = others.find((other) => asRole(other.role) === "admin") ?? others[0]!
      if (asRole(membership.role) === "owner" && !others.some((other) => asRole(other.role) === "owner"))
        changes.push(db.update(member).set({ role: "owner" }).where(eq(member.id, heir.id)))
      changes.push(db.delete(member).where(eq(member.id, membership.id)))
    }
    for (const { id, members } of seats)
      changes.push(db.update(subscription).set({ seats: members }).where(eq(subscription.id, id)))
    const [first, ...rest] = changes
    if (first) await db.batch([first, ...rest])
  } catch (error) {
    const failures = []
    for (const seat of attempted.reverse()) {
      try {
        await seat.restore()
      } catch (failure) {
        failures.push(failure)
      }
    }
    if (failures.length)
      throw new AggregateError([error, ...failures], `${String(error)}; Stripe seat restoration also failed`, {
        cause: error,
      })
    throw error
  }
  const outcome: { left: string[]; deleted: string[] } = { left: [], deleted: [] }
  for (const { membership, team, others } of left) {
    if (others.length) await hooks.afterRemoveMember?.({ member: membership, user, organization: team })
    outcome[others.length ? "left" : "deleted"].push(team.id)
  }
  requestLog(authRequest.getStore())?.set({ teams: outcome })
}
