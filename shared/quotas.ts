export const PLANS = ["free", "pro", "unlimited"] as const
export type Plan = typeof PLANS[number]
export const MIB = 1024 * 1024

export interface PlanLimits {
  drops: number | null
  bytes: number | null
  writes: number | null
  appFiles: number
  appBytes: number
}

/** Global app safety limits also apply when owner quotas are disabled. */
export function planLimits(plan: Plan, pro: { drops?: number; bytes?: number; writes?: number } = {}): PlanLimits {
  if (plan === "free") return { drops: 3, bytes: 100 * MIB, writes: 1000, appFiles: 50, appBytes: 2 * MIB }
  if (plan === "pro") return { drops: pro.drops ?? 100, bytes: pro.bytes ?? 1024 * MIB, writes: pro.writes ?? 10_000, appFiles: 200, appBytes: 4 * MIB }
  return { drops: null, bytes: null, writes: null, appFiles: 200, appBytes: 4 * MIB }
}

export function isPlan(value: unknown): value is Plan {
  return PLANS.includes(value as Plan)
}

export interface Usage {
  enabled: boolean
  plan: Plan
  month: string
  drops: { used: number; limit: number | null }
  bytes: { used: number; limit: number | null }
  writes: { used: number; limit: number | null }
  app: { files: number; bytes: number }
  upgradeUrl: string
  selfHostUrl: string
}

export type QuotaUnit = "drops" | "bytes" | "writes" | "appFiles" | "appBytes" | "burstPublishes"
export interface QuotaFailure {
  code: "DROP_LIMIT_REACHED"
  quota: { unit: QuotaUnit; used: number; limit: number }
  retryable: false
  upgradeUrl: string
  selfHostUrl: string
  message: string
}

export function quotaFailure(unit: QuotaUnit, used: number, limit: number): QuotaFailure {
  const upgradeUrl = "/settings/billing"
  const selfHostUrl = "/docs/self-host"
  const label = { drops: "drops", bytes: "storage", writes: "monthly file writes", appFiles: "app files", appBytes: "app size", burstPublishes: "publishes this minute" }[unit]
  const amount = unit === "bytes" || unit === "appBytes"
    ? `${Math.ceil(used / MIB * 10) / 10}/${limit / MIB} MiB`
    : `${used}/${limit}`
  return {
    code: "DROP_LIMIT_REACHED", quota: { unit, used, limit }, retryable: false, upgradeUrl, selfHostUrl,
    message: `Nothing was created or changed. Plan limit for ${label}: ${amount}. Upgrade at ${upgradeUrl} or deploy your own at ${selfHostUrl}.`,
  }
}

export function usageNearLimit(usage: Usage): boolean {
  return usage.enabled && ((usage.drops.limit !== null && usage.drops.used >= Math.ceil(usage.drops.limit * 2 / 3))
    || (usage.bytes.limit !== null && usage.bytes.used >= usage.bytes.limit * 0.8)
    || (usage.writes.limit !== null && usage.writes.used >= usage.writes.limit * 0.8))
}

export function quotaToolFailure(body: QuotaFailure) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `${body.message} Ask the user what to do. Do not retry or delete their work.` }],
    structuredContent: { ...body },
  }
}
