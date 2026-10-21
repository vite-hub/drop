import { and, count, eq, inArray, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { member, organization, subscription } from "../databases/config"
import type { DropRow } from "./drops/types"

// Teams on a personal Drop. A team is a Better Auth organization: its members, their roles, and invitations live there.
// What a team shares lives in its team folders (`drops.team_id`), which reach the team's members only. A team folder on a
// personal Drop works like one on a team Drop (`DROP_MODE=team`), with the team in place of everyone signed in.
//
// Billing is per team: the first `DROP_FREE_TEAM_MEMBERS` members are free, and a bigger team needs a subscription,
// one seat per member. Everyone on a team that pays gets the Pro plan, across all their drops, and no boards: Drop's
// boards run on tldraw, whose free license doesn't cover paid use.

/** `owner` made the team and pays for it; `admin` manages its folders and people; `member` adds to its folders. */
export type TeamRole = "owner" | "admin" | "member"
export const TEAM_ROLES: TeamRole[] = ["owner", "admin", "member"]
const asRole = (role: string): TeamRole => (role === "owner" || role === "admin" ? role : "member")

/** Subscription states that pay for a team. `past_due` keeps it while Stripe retries the card. */
export const PAYING = ["active", "trialing", "past_due"] as const

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

/** The teams of `ids` a subscription pays for now. */
export async function paidTeams(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db
    .select({ team: subscription.referenceId })
    .from(subscription)
    .where(and(inArray(subscription.referenceId, ids), inArray(subscription.status, [...PAYING])))
  return new Set(rows.map((row) => row.team))
}

/** Whether someone is on a team that pays: then they're on the Pro plan, and can't make boards. */
export async function isPaying(userId: string, event?: H3Event): Promise<boolean> {
  if (!billingConfig(event).enabled) return false
  const [row] = await db.all<{ paying: number }>(sql`SELECT EXISTS (
    SELECT 1 FROM ${member} m JOIN ${subscription} s ON s.reference_id = m.organization_id
    WHERE m.user_id = ${userId} AND s.status IN ('active', 'trialing', 'past_due')
  ) AS paying`)
  return Boolean(row?.paying)
}

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

/** The names of teams, for labels. */
export async function teamNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
