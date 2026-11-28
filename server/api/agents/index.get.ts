import { desc, eq } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database"
import { oauthClient, oauthConsent } from "../../databases/default/index"
import { requireIdentity } from "../../utils/identity"

const EXTENSION_REDIRECT = /https:\/\/[a-z0-9-]+\.(?:chromiumapp\.org|extensions\.allizom\.org)\//

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const rows = await db
    .select({
      id: oauthConsent.id,
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      redirects: oauthClient.redirectUris,
      createdAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, who.userId))
    .orderBy(desc(oauthConsent.createdAt))
  return rows.map((row) => ({
    id: row.id,
    name: EXTENSION_REDIRECT.test(row.redirects ?? "") ? "Browser extension" : row.name || "MCP client",
    connectedAt: row.createdAt?.getTime() ?? null,
  }))
})
