// doctor-disable nuxt/middleware/no-route-middleware-api-security -- public on purpose: signed out, it answers null.
import { eq, inArray } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { organization, workspaceStats } from "../databases/config"
import type { Viewer } from "#shared/types"
import { expiryPolicy } from "../utils/expiry"
import { identify } from "../utils/identity"
import { sharePolicy } from "../utils/share"
import { enabledSkills } from "../utils/skills"
import { billingConfig, paidTeams, teamsEnabled } from "../utils/teams"

export default defineHandler(async (event): Promise<Viewer | null> => {
  const who = await identify(event)
  if (!who) return null
  const { mode, publicLinkDays } = sharePolicy(event)
  const ids = Object.keys(who.teams ?? {})
  const billing = billingConfig(event)
  // The page waits for /api/me before loading the drop. These reads depend only on the identity, so start them
  // together: separate awaits add database round trips, including the first skill-settings read per isolate.
  const [[row], rows, skills, paid] = await Promise.all([
    db.select({ total: workspaceStats.members }).from(workspaceStats).where(eq(workspaceStats.id, 1)),
    ids.length
      ? db
          .select({ id: organization.id, name: organization.name, slug: organization.slug })
          .from(organization)
          .where(inArray(organization.id, ids))
      : [],
    // The sidebar hides Skills from members while none is on.
    enabledSkills().then((enabled) => enabled.length),
    billing.enabled ? paidTeams(ids) : new Set<string>(),
  ])
  const members = row?.total ?? 1
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
    ...(teamsEnabled(event) ? { teams } : {}),
    ...(billing.enabled
      ? { billing: { freeMembers: billing.freeMembers, annual: Boolean(billing.annualPriceId) }, paid: paid.size > 0 }
      : {}),
  }
})
