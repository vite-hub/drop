// doctor-disable nuxt/middleware/no-route-middleware-api-security -- public on purpose: signed out, it answers null.
import { eq } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { workspaceStats } from "../databases/config"
import type { Viewer } from "#shared/types"
import { expiryPolicy } from "../utils/expiry"
import { identify } from "../utils/identity"
import { sharePolicy } from "../utils/share"

export default defineHandler(async (event): Promise<Viewer | null> => {
  const who = await identify(event)
  if (!who) return null
  const [row] = await db.select({ total: workspaceStats.members }).from(workspaceStats).where(eq(workspaceStats.id, 1))
  const members = row?.total ?? 1
  const { mode, publicLinkDays } = sharePolicy(event)
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
  }
})
