import { and, eq, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { isbot } from "isbot"
import { db } from "vite-hub/database"
import { useServerEnv } from "vite-hub/env"
import { DAY_MS, DEFAULT_EXPIRY_DAYS, expiresAt } from "#shared/expiry"
import { drops } from "../databases/default/index"
import type { Identity } from "./identity"
import { logError } from "./logs"

interface ExpiryPolicy {
  days: number
  custom: boolean
}

export function expiryPolicy(event?: H3Event): ExpiryPolicy {
  const { expiryDays, customExpiry } = useServerEnv(event).drop
  return { days: expiryDays >= 0 ? Math.floor(expiryDays) : DEFAULT_EXPIRY_DAYS, custom: customExpiry }
}

type ExpiryFields = Pick<typeof drops.$inferSelect, "createdAt" | "lastAccessedAt" | "lifetime">

export function isExpired(row: ExpiryFields, now: number, days: number) {
  const at = expiresAt(row, days)
  return at !== null && at <= now
}

export function isHumanVisit(headers: Headers, kind: "beacon" | "document") {
  const agent = headers.get("user-agent")?.trim()
  if (!agent || isbot(agent)) return false
  if (kind === "beacon") return headers.get("sec-fetch-site") === "same-origin"
  return headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document"
}

export async function recordVisit(
  event: H3Event,
  row: ExpiryFields & {
    id: string
    ownerId: string
    quarantinedAt: number | null
    trashedAt: number | null
    ancestors?: { id: string; ownerId: string }[]
  },
  who: Identity | null,
  kind: "beacon" | "document",
) {
  const now = Date.now()
  const { days } = expiryPolicy(event)
  if (!days || row.lifetime === "keep" || row.trashedAt || row.quarantinedAt || isExpired(row, now, days)) return
  if ((row.lastAccessedAt ?? row.createdAt) > now - DAY_MS) return
  if (!who && !isHumanVisit(event.req.headers, kind)) return
  try {
    await renewDrop(
      row.ancestors?.at(-1) ?? row,
      now,
      sql`coalesce(${drops.lastAccessedAt}, ${drops.createdAt}) <= ${now - DAY_MS}`,
    )
  } catch (error) {
    logError(event, error, { action: "drop-visit" })
  }
}

export const renewDrop = (row: { id: string }, now = Date.now(), when = sql`1`) =>
  db
    .update(drops)
    .set({ lastAccessedAt: now })
    .where(and(eq(drops.id, row.id), when))
