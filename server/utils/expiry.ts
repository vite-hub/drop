import { and, sql } from "drizzle-orm"
import { log } from "evlog"
import type { H3Event } from "h3"
import { isbot } from "isbot"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { DAY_MS, DEFAULT_EXPIRY_DAYS, expiresAt } from "#shared/expiry"
import { drops } from "../databases/config"
import type { Identity } from "./identity"
import { bindQuotaSQL, deletionChainSQL } from "./quota-sql"

export interface ExpiryPolicy {
  /** Days a `review` drop lives after its last visit (`temporary` ones get at most 14). 0 turns expiry off. */
  days: number
  /** Whether owners and their agents may keep drops. Admins always may. */
  custom: boolean
}

export function expiryPolicy(event?: H3Event): ExpiryPolicy {
  const env = useServerEnv(event).drop
  const days = Number(env.expiryDays)
  return { days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_EXPIRY_DAYS, custom: env.customExpiry !== "0" }
}

type ExpiryFields = Pick<typeof drops.$inferSelect, "createdAt" | "lastAccessedAt" | "lifetime">

export function isExpired(row: ExpiryFields, now: number, days: number) {
  const at = expiresAt(row, days)
  return at !== null && at <= now
}

/** Every row of a drop's version chain, so all versions share one expiry. */
export const chainOf = (row: { id: string; ownerId: string }) =>
  bindQuotaSQL(deletionChainSQL, [row.id, row.ownerId, row.ownerId, row.id, row.ownerId, row.ownerId])

/**
 * Whether an anonymous request looks like a person in a browser. Link unfurlers, crawlers, and uptime checks
 * either send a bot user agent or never run the page's script. `beacon` is the shared page's same-origin call
 * after it renders; `document` is a direct navigation to a raw file. Embedded images and hotlinks never count.
 */
export function isHumanVisit(headers: Headers, kind: "beacon" | "document") {
  const agent = headers.get("user-agent")?.trim()
  if (!agent || isbot(agent)) return false
  if (kind === "beacon") return headers.get("sec-fetch-site") === "same-origin"
  return headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document"
}

/**
 * Restarts the drop's expiry window. People and agents who identify themselves always count; anonymous visitors
 * count when they pass `isHumanVisit`. Writes at most once a day per drop, and never revives an expired drop:
 * that takes an explicit renew.
 */
export async function recordVisit(event: H3Event, row: ExpiryFields & { id: string; ownerId: string; quarantinedAt: number | null; trashedAt: number | null; parentId: string | null }, who: Identity | null, kind: "beacon" | "document") {
  const now = Date.now()
  const { days } = expiryPolicy(event)
  // An attachment lives as long as its doc, so visiting the doc is what counts.
  if (!days || row.lifetime === "keep" || row.parentId || row.trashedAt || row.quarantinedAt || isExpired(row, now, days)) return
  if ((row.lastAccessedAt ?? row.createdAt) > now - DAY_MS) return
  if (!who && !isHumanVisit(event.req.headers, kind)) return
  try {
    await renewDrop(row, now, sql`coalesce(${drops.lastAccessedAt}, ${drops.createdAt}) <= ${now - DAY_MS}`)
  }
  catch (error) {
    log.error({ action: "drop-visit", error: String(error) })
  }
}

/** Starts a fresh window for every version of the drop. */
export const renewDrop = (row: { id: string; ownerId: string }, now = Date.now(), when = sql`1`) =>
  db.update(drops).set({ lastAccessedAt: now }).where(and(sql`${drops.id} IN (${chainOf(row)})`, when))
