export const DAY_MS = 86_400_000
export const DEFAULT_EXPIRY_DAYS = 30
export const TEMPORARY_DAYS = 14
export const TRASH_DAYS = 15

export const LIFETIMES = ["temporary", "review", "keep"] as const
export type Lifetime = (typeof LIFETIMES)[number]
export const MAX_KEEP_REASON = 280

interface ExpiryRow {
  createdAt: number
  lastAccessedAt: number | null
  lifetime: Lifetime
}

export function lifetimeDays(lifetime: Lifetime, days: number) {
  if (lifetime === "keep" || days <= 0) return 0
  return lifetime === "temporary" ? Math.min(TEMPORARY_DAYS, days) : days
}

export function expiresAt(row: ExpiryRow, days: number): number | null {
  const window = lifetimeDays(row.lifetime, days)
  return window ? (row.lastAccessedAt ?? row.createdAt) + window * DAY_MS : null
}

export const purgesAt = (trashedAt: number) => trashedAt + TRASH_DAYS * DAY_MS

export const daysUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / DAY_MS))

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`

export function lifetimeLabel(lifetime: Lifetime, days: number) {
  const window = lifetimeDays(lifetime, days)
  return window ? plural(window, "day") : "Forever"
}

export function lifetimeHint(lifetime: Lifetime, days: number) {
  const window = lifetimeDays(lifetime, days)
  return window
    ? `Goes to the Trash if nobody opens it for ${plural(window, "day")}.`
    : "Stays until someone deletes it."
}

export function expiryLabel(drop: { expiresAt: number | null; trashedAt: number | null }, now: number) {
  if (drop.trashedAt !== null)
    return `In the Trash. Deleted for good in ${plural(daysUntil(purgesAt(drop.trashedAt), now), "day")}`
  if (drop.expiresAt === null) return "Never deleted"
  return `Goes to the Trash in ${plural(daysUntil(drop.expiresAt, now), "day")}`
}
