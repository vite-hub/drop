import { defineHandler } from "h3"
import { sql } from "drizzle-orm"
import { useRuntimeConfig } from "nitro/runtime-config"
import { db } from "vite-hub/database"

export default defineHandler(async () => {
  await db.get(sql`SELECT 1`)
  const { version, commit } = useRuntimeConfig().release
  return { ok: true, version, commit }
})
