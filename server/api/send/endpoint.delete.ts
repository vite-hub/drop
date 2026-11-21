import { defineHandler } from "h3"
import { eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { webhookEndpoints } from "vite-hub/webhooks/database"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.owner, who.userId))
  return null
})
