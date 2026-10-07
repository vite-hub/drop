import { count } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { user } from "../databases/config"
import type { Viewer } from "#shared/types"
import { identify } from "../utils/identity"

export default defineHandler(async (event): Promise<Viewer | null> => {
  const who = await identify(event)
  if (!who) return null
  const [row] = await db.select({ total: count() }).from(user)
  const members = row?.total ?? 1
  return { id: who.userId, name: who.name, email: who.email, image: who.image, role: who.role, team: members > 1, members }
})
