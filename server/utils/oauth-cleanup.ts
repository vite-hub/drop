import { and, eq, lt, notExists } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../databases/config"

/** A consent or issued token proves the client completed authorization. Keep those clients. */
export async function cleanupUnusedOAuthClients(now: Date) {
  await db.delete(oauthClient).where(and(
    lt(oauthClient.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    notExists(db.select({ id: oauthConsent.id }).from(oauthConsent).where(eq(oauthConsent.clientId, oauthClient.clientId))),
    notExists(db.select({ id: oauthAccessToken.id }).from(oauthAccessToken).where(eq(oauthAccessToken.clientId, oauthClient.clientId))),
    notExists(db.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, oauthClient.clientId))),
  ))
}
