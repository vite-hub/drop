// A drop lives while people or agents use it. Each real visit restarts the window; a drop nobody opens expires,
// stays restorable for a grace period, then the hourly cleanup deletes it. "Never expires" opts a drop out.
export const DAY_MS = 86_400_000
export const DEFAULT_EXPIRY_DAYS = 30
export const EXPIRY_GRACE_DAYS = 7

export interface ExpiryRow { createdAt: number; lastAccessedAt: number | null; neverExpires: boolean }

/** When the drop stops being served, or null when it never expires. `days` of 0 turns expiry off. */
export function expiresAt(row: ExpiryRow, days: number): number | null {
  if (row.neverExpires || days <= 0) return null
  return (row.lastAccessedAt ?? row.createdAt) + days * DAY_MS
}

/** When the hourly cleanup deletes an expired drop. */
export const deletesAt = (expiry: number) => expiry + EXPIRY_GRACE_DAYS * DAY_MS

export const daysUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / DAY_MS))

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`

/** One status line for people and agents alike: "Expires in 6 days", "Never expires", "Expired, deleting in 2 days". */
export function expiryLabel(drop: { expiresAt: number | null; neverExpires: boolean }, now: number) {
  if (drop.neverExpires) return "Never expires"
  if (drop.expiresAt === null) return "Doesn't expire"
  if (drop.expiresAt > now) return `Expires in ${plural(daysUntil(drop.expiresAt, now), "day")}`
  return `Expired, deleting in ${plural(daysUntil(deletesAt(drop.expiresAt), now), "day")}`
}
