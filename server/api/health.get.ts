import { defineHandler } from "h3"
import { sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"

export default defineHandler(async () => {
  await db.get(sql`SELECT 1`)
  return { ok: true }
})
