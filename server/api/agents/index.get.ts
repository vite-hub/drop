import { desc, eq } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { oauthClient, oauthConsent } from "../../databases/config"
import { requireIdentity } from "../../utils/identity"

/** The agents (MCP clients) this person approved, newest first. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const rows = await db.select({ id: oauthConsent.id, clientId: oauthConsent.clientId, name: oauthClient.name, createdAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, who.userId))
    .orderBy(desc(oauthConsent.createdAt))
  return rows.map(row => ({ id: row.id, name: row.name || "MCP client", connectedAt: row.createdAt?.getTime() ?? null }))
})
