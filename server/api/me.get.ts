// doctor-disable nuxt/middleware/no-route-middleware-api-security -- public on purpose: signed out, it answers null.
import { and, count, eq, inArray } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { drops, organization, workspaceStats } from "../databases/config"
import type { Viewer } from "#shared/types"
import { expiryPolicy } from "../utils/expiry"
import { identify } from "../utils/identity"
import { sharePolicy } from "../utils/share"
import { enabledSkills } from "../utils/skills"
import { billingConfig, paidTeams, teamsEnabled } from "../utils/teams"

export default defineHandler(async (event): Promise<Viewer | null> => {
  const who = await identify(event)
  if (!who) return null
  const [row] = await db.select({ total: workspaceStats.members }).from(workspaceStats).where(eq(workspaceStats.id, 1))
  const members = row?.total ?? 1
  // The same shares /admin/review lists as pending, counted for the sidebar's Review shares row.
  const [pending] =
    who.role === "admin"
      ? await db
          .select({ n: count() })
          .from(drops)
          .where(and(inArray(drops.share, ["public", "public_comment"]), eq(drops.shareReview, "pending")))
      : []
  const { mode, publicLinkDays } = sharePolicy(event)
  const ids = Object.keys(who.teams ?? {})
  const rows = ids.length
    ? await db
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(inArray(organization.id, ids))
    : []
  // The sidebar hides Skills from members while none is on.
  const skills = (await enabledSkills()).length
  const billing = billingConfig(event)
  const paid = billing.enabled ? await paidTeams(ids) : new Set<string>()
  const teams = rows
    .map((item) => ({ ...item, role: who.teams![item.id]!, paid: paid.has(item.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: who.userId,
    name: who.name,
    email: who.email,
    image: who.image,
    role: who.role,
    expiry: expiryPolicy(event),
    mode,
    publicLinkDays,
    members,
    skills,
    ...(pending && { reviews: pending.n }),
    ...(teamsEnabled(event) ? { teams } : {}),
    ...(billing.enabled
      ? { billing: { freeMembers: billing.freeMembers, annual: Boolean(billing.annualPriceId) }, paid: paid.size > 0 }
      : {}),
  }
})
