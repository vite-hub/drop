import { desc, sql } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { abuseReports } from "../../../databases/config"
import { requireAdmin } from "../../../utils/identity"
export default defineHandler(async (event) => {
  await requireAdmin(event)
  event.res.headers.set("Cache-Control", "private, no-store")
  return db.select().from(abuseReports).orderBy(sql`CASE WHEN ${abuseReports.status} = 'open' THEN 0 ELSE 1 END`, desc(abuseReports.createdAt)).limit(200)
})
