export const PLANS = ["free", "pro", "unlimited"] as const
export type Plan = typeof PLANS[number]
export const MIB = 1024 * 1024
export const MAX_APP_FILES = 200
export const MAX_APP_BYTES = 4 * MIB
export const DEFAULT_PRO_LIMITS = { drops: 100, bytes: 1024 * MIB, writes: 10_000 } as const

export interface PlanLimits {
  drops: number | null
  bytes: number | null
  writes: number | null
  appFiles: number
  appBytes: number
}

/** Global app safety limits also apply when owner quotas are disabled. */
export function planLimits(plan: Plan, pro: { drops?: number; bytes?: number; writes?: number } = {}): PlanLimits {
  if (plan === "free") return { drops: 50, bytes: 100 * MIB, writes: 1000, appFiles: 50, appBytes: 2 * MIB }
  if (plan === "pro") return { drops: pro.drops ?? DEFAULT_PRO_LIMITS.drops, bytes: pro.bytes ?? DEFAULT_PRO_LIMITS.bytes, writes: pro.writes ?? DEFAULT_PRO_LIMITS.writes, appFiles: MAX_APP_FILES, appBytes: MAX_APP_BYTES }
  return { drops: null, bytes: null, writes: null, appFiles: MAX_APP_FILES, appBytes: MAX_APP_BYTES }
}

export interface Usage {
  enabled: boolean
  plan: Plan
  month: string
  drops: { used: number; limit: number | null }
  bytes: { used: number; limit: number | null }
  writes: { used: number; limit: number | null }
  app: { files: number; bytes: number }
  selfHostUrl: string
}

export type QuotaUnit = "drops" | "bytes" | "writes" | "appFiles" | "appBytes" | "burstPublishes"
export interface QuotaFailure {
  code: "DROP_LIMIT_REACHED"
  quota: { unit: QuotaUnit; used: number; limit: number }
  /** Only the per-minute publish limit clears by waiting; every other limit needs the user. */
  retryable: boolean
  /** Seconds until a retryable limit clears. */
  retryAfterSeconds?: number
  /** When the counter resets: the next minute for publishes, the next month (UTC) for file writes. Absent for limits that never reset on their own. */
  resetAt?: string
  selfHostUrl: string
  message: string
}

/** The first instant of next month, UTC, when monthly file writes start over. */
export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

export function quotaFailure(unit: QuotaUnit, used: number, limit: number, retryAfterSeconds = 60): QuotaFailure {
  const selfHostUrl = "/docs/self-host"
  if (unit === "burstPublishes") {
    return {
      code: "DROP_LIMIT_REACHED", quota: { unit, used, limit }, retryable: true, retryAfterSeconds,
      resetAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(), selfHostUrl,
      message: `Nothing was created or changed. That's ${limit} publishes in a minute; wait ${retryAfterSeconds} seconds, then publish again.`,
    }
  }
  const label = { drops: "drops", bytes: "storage", writes: "monthly file writes", appFiles: "app files", appBytes: "app size" }[unit]
  const amount = unit === "bytes" || unit === "appBytes"
    ? `${Math.ceil(used / MIB * 10) / 10}/${limit / MIB} MiB`
    : `${used}/${limit}`
  const resetAt = unit === "writes" ? nextMonthStart().toISOString() : undefined
  const fix = {
    drops: "Trash drops you no longer need, or ask the user.",
    bytes: "Trash large drops you no longer need, or ask the user.",
    writes: `It resets on ${resetAt?.slice(0, 10)}.`,
    appFiles: "Publish fewer files: bundle scripts and styles together.",
    appBytes: "Publish a smaller app: compress images or load large libraries from a CDN.",
  }[unit]
  return {
    code: "DROP_LIMIT_REACHED", quota: { unit, used, limit }, retryable: false, ...(resetAt ? { resetAt } : {}), selfHostUrl,
    message: `Nothing was created or changed. Plan limit for ${label}: ${amount}. ${fix} Deploy your own at ${selfHostUrl} for other limits.`,
  }
}

export function usageNearLimit(usage: Usage): boolean {
  return usage.enabled && ((usage.drops.limit !== null && usage.drops.used >= Math.ceil(usage.drops.limit * 2 / 3))
    || (usage.bytes.limit !== null && usage.bytes.used >= usage.bytes.limit * 0.8)
    || (usage.writes.limit !== null && usage.writes.used >= usage.writes.limit * 0.8))
}

export function quotaToolFailure(body: QuotaFailure) {
  const next = body.retryable
    ? `Wait ${body.retryAfterSeconds ?? 60} seconds, then make the same call once more.`
    : "Ask the user what to do. Do not retry or delete their work; list_drops shows plan usage."
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `${body.message} ${next}` }],
    structuredContent: { ...body },
  }
}
