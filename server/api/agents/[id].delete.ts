import { and, eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database"
import { oauthAccessToken, oauthConsent, oauthRefreshToken } from "../../databases/default/index"
import { requireIdentity } from "../../utils/identity"
import { logAudit } from "../../utils/logs"
import { routeId } from "../../utils/params"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const [consent] = await db
    .select()
    .from(oauthConsent)
    .where(and(eq(oauthConsent.id, await routeId(event)), eq(oauthConsent.userId, who.userId)))
    .limit(1)
  if (!consent) throw new HTTPError({ status: 404, statusText: "No connected agent with that id." })
  const mine = (table: typeof oauthRefreshToken | typeof oauthAccessToken) =>
    and(eq(table.clientId, consent.clientId), eq(table.userId, who.userId))
  await db.delete(oauthRefreshToken).where(mine(oauthRefreshToken))
  await db.delete(oauthAccessToken).where(mine(oauthAccessToken))
  await db.delete(oauthConsent).where(eq(oauthConsent.id, consent.id))
  logAudit(event, who, "agent.disconnect", { type: "oauth-client", id: consent.clientId })
  return { ok: true }
})
