// A drop lives while people or agents use it. Each real visit restarts its window; a drop nobody opens expires
// into the Trash, and the hourly cleanup deletes what has been in the Trash for 15 days. Whoever publishes picks
// how long the window is: `temporary` for prototypes, `review` for docs going through feedback, `keep` for good.
export const DAY_MS = 86_400_000
export const DEFAULT_EXPIRY_DAYS = 30
export const TEMPORARY_DAYS = 14
export const TRASH_DAYS = 15

export const LIFETIMES = ["temporary", "review", "keep"] as const
export type Lifetime = (typeof LIFETIMES)[number]
/** An agent's reason for keeping a drop: a sentence or two. */
export const MAX_KEEP_REASON = 280

export interface ExpiryRow {
  createdAt: number
  lastAccessedAt: number | null
  lifetime: Lifetime
}

/** Days a drop with this lifetime lives after its last visit; 0 means it never expires. `days` of 0 turns expiry off. */
export function lifetimeDays(lifetime: Lifetime, days: number) {
  if (lifetime === "keep" || days <= 0) return 0
  return lifetime === "temporary" ? Math.min(TEMPORARY_DAYS, days) : days
}

/** When the drop stops being served and lands in the Trash, or null when it never expires. */
export function expiresAt(row: ExpiryRow, days: number): number | null {
  const window = lifetimeDays(row.lifetime, days)
  return window ? (row.lastAccessedAt ?? row.createdAt) + window * DAY_MS : null
}

/** When the hourly cleanup deletes a drop that went to the Trash at `trashedAt`. */
export const purgesAt = (trashedAt: number) => trashedAt + TRASH_DAYS * DAY_MS

export const daysUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / DAY_MS))

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`

/** One status line for people and agents alike: "Expires in 6 days", "Kept", "In the Trash, deleting in 2 days". */
export function expiryLabel(
  drop: { expiresAt: number | null; lifetime: Lifetime; trashedAt: number | null },
  now: number,
) {
  if (drop.trashedAt !== null)
    return `In the Trash, deleting in ${plural(daysUntil(purgesAt(drop.trashedAt), now), "day")}`
  if (drop.lifetime === "keep") return "Kept"
  if (drop.expiresAt === null) return "Doesn't expire"
  return `Expires in ${plural(daysUntil(drop.expiresAt, now), "day")}`
}
