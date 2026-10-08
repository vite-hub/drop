import { eq, inArray, lte, sql, type SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { type H3Event, HTTPError } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import { db } from "vite-hub/database/drizzle"
import { blob } from "vite-hub/blob"
import { requireRateLimit } from "vite-hub/rate-limit"
import { DEFAULT_PRO_LIMITS, MAX_APP_BYTES, MAX_APP_FILES, isPlan, planLimits, quotaFailure, quotaToolFailure, type Plan, type QuotaFailure, type Usage } from "#shared/quotas"
import { quotaBlobs, quotaReservations, user } from "../databases/config"
import { reserveSQL, usageSQL } from "./quota-sql"

const atomic = db as unknown as Pick<DrizzleD1Database, "batch">
type Statement = Parameters<DrizzleD1Database["batch"]>[0][number]

export function quotaConfig() {
  const config = useRuntimeConfig().quotas
  const positive = (value: unknown, fallback: number) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  return {
    enabled: process.env.DROP_QUOTAS === "1" || config.enabled === true || String(config.enabled) === "1" || String(config.enabled) === "true",
    defaultPlan: isPlan(config.defaultPlan) ? config.defaultPlan : "free" as Plan,
    pro: { drops: positive(config.proDrops, DEFAULT_PRO_LIMITS.drops), bytes: positive(config.proBytes, DEFAULT_PRO_LIMITS.bytes), writes: positive(config.proWrites, DEFAULT_PRO_LIMITS.writes) },
  }
}

export function effectivePlan(value: unknown): Plan {
  return isPlan(value) ? value : quotaConfig().defaultPlan
}

// Bind values, never interpolate them into the SQL text.
function bind(query: string, values: unknown[]): SQL {
  const parts = query.split("?")
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""))
}

async function ownerUsage(ownerId: string, month: string) {
  const [row] = await db.all<{ drops: number; bytes: number; writes: number }>(bind(usageSQL, [ownerId, month]))
  return row ?? { drops: 0, bytes: 0, writes: 0 }
}

export async function getUsage(ownerId: string): Promise<Usage> {
  const config = quotaConfig()
  const [owner] = await db.select({ plan: user.plan }).from(user).where(eq(user.id, ownerId)).limit(1)
  const plan = effectivePlan(owner?.plan)
  const limits = planLimits(config.enabled ? plan : "unlimited", config.pro)
  const month = new Date().toISOString().slice(0, 7)
  const used = await ownerUsage(ownerId, month)
  return {
    enabled: config.enabled, plan, month,
    drops: { used: used.drops, limit: limits.drops }, bytes: { used: used.bytes, limit: limits.bytes }, writes: { used: used.writes, limit: limits.writes },
    app: { files: limits.appFiles, bytes: limits.appBytes }, upgradeUrl: "/settings/billing", selfHostUrl: "/docs/self-host",
  }
}

export class DropQuotaError extends HTTPError {
  readonly quotaBody: QuotaFailure
  constructor(body: QuotaFailure) {
    super({ status: 402, message: body.message, data: body, body: { ...body } })
    this.quotaBody = body
  }
}

/** MCP limits are ordinary tool results, so agents can act on them without a protocol retry. */
export async function quotaToolResult<T>(operation: () => Promise<T>) {
  try { return await operation() }
  catch (error) {
    if (!(error instanceof DropQuotaError)) throw error
    return quotaToolFailure(error.quotaBody)
  }
}

interface Cost { drops: number; bytes: number; writes: number; targetId?: string; app?: { files: number; bytes: number } }

/** Reserve before touching blobs. Transfer to the write ledger in the metadata batch, or release on failure. */
export async function withDropQuota<T>(ownerId: string, cost: Cost, event: H3Event | undefined, operation: (quota: { commit: (statements: Statement[], success?: SQL) => Promise<void> }) => Promise<T>): Promise<T> {
  const config = quotaConfig()
  const usage = config.enabled ? await getUsage(ownerId) : {
    month: new Date().toISOString().slice(0, 7), plan: "unlimited",
    drops: { limit: null }, bytes: { limit: null }, writes: { limit: null }, app: { files: MAX_APP_FILES, bytes: MAX_APP_BYTES },
  }
  if (cost.app) {
    if (cost.app.files > usage.app.files) throw new DropQuotaError(quotaFailure("appFiles", cost.app.files, usage.app.files))
    if (cost.app.bytes > usage.app.bytes) throw new DropQuotaError(quotaFailure("appBytes", cost.app.bytes, usage.app.bytes))
  }
  if (config.enabled && event && !import.meta.dev && usage.plan !== "unlimited") {
    try { await requireRateLimit(event, "owner-publish", { failure: "deny", key: ownerId, limit: 30, window: "1m" }) }
    catch (error) {
      if ((error as { status?: number; statusCode?: number }).status === 429 || (error as { statusCode?: number }).statusCode === 429)
        throw new DropQuotaError(quotaFailure("burstPublishes", 30, 30))
      throw error
    }
  }

  const id = crypto.randomUUID()
  let reserved: { id: string }[]
  try {
    reserved = config.enabled ? await db.all<{ id: string }>(bind(reserveSQL, [
      ownerId, usage.month, id, cost.drops, cost.bytes, cost.writes, cost.targetId ?? null, Date.now(),
      usage.drops.limit === null ? 0 : 1, cost.drops, usage.drops.limit ?? 0,
      usage.bytes.limit === null ? 0 : 1, cost.bytes, usage.bytes.limit ?? 0,
      usage.writes.limit === null ? 0 : 1, cost.writes, usage.writes.limit ?? 0,
    ])) : await db.insert(quotaReservations).values({
      id, ownerId, month: usage.month, drops: cost.drops, bytes: cost.bytes, writes: cost.writes, targetId: null, createdAt: Date.now(),
    }).returning({ id: quotaReservations.id })
  }
  catch (error) {
    if (/quota_pending_target_idx|quota_reservations.target_id/i.test(String(error)))
      throw new HTTPError({ status: 409, message: "This drop is being published. Wait for that publish to finish." })
    throw error
  }
  if (!reserved.length) {
    const used = await ownerUsage(ownerId, usage.month)
    for (const unit of ["drops", "bytes", "writes"] as const) {
      const limit = usage[unit].limit
      // A lowered plan doesn't block a write that adds no slots or bytes.
      if (limit !== null && cost[unit] > 0 && used[unit] + cost[unit] > limit)
        throw new DropQuotaError(quotaFailure(unit, used[unit], limit))
    }
    throw new HTTPError({ status: 409, message: "Usage changed while publishing. Check usage before publishing again." })
  }

  let committed = false
  try {
    const result = await operation({
      commit: async (statements, success = sql`1`) => {
        // A failed guard violates the ledger CHECK and rolls back the entire D1 batch.
        const finish = db.update(quotaReservations).set({ committed: true, drops: 0, bytes: 0, writes: sql`CASE WHEN (${success}) THEN ${quotaReservations.writes} ELSE -1 END` })
          .where(eq(quotaReservations.id, id)).returning({ id: quotaReservations.id })
        const batch: [Statement, ...Statement[]] = [finish]
        batch.unshift(...statements)
        let results
        try { results = await atomic.batch(batch) }
        catch (error) {
          if (/CHECK constraint failed.*writes/i.test(String(error)))
            throw new HTTPError({ status: 409, message: "This drop changed while publishing. Read the latest version.", cause: error })
          throw error
        }
        committed = (results.at(-1) as { id: string }[]).some(row => row.id === id)
        if (!committed) throw new HTTPError({ status: 409, message: "This drop changed while publishing. Read the latest version." })
      },
    })
    if (!committed) throw new Error("Publishing must commit its quota reservation with its metadata.")
    return result
  }
  finally {
    if (!committed) await db.delete(quotaReservations).where(eq(quotaReservations.id, id))
  }
}

export async function releaseQuotaBlobs(keys: string[]) {
  // D1's bind limit is lower than a blob-list page size.
  for (let offset = 0; offset < keys.length; offset += 80)
    await db.delete(quotaBlobs).where(inArray(quotaBlobs.blobKey, keys.slice(offset, offset + 80)))
}

/** Retry tracked images first, including a prior deletion whose ledger cleanup failed. */
export async function cleanupQuotaBlobs(now: Date) {
  for (;;) {
    const rows = await db.select({ key: quotaBlobs.blobKey }).from(quotaBlobs).where(lte(quotaBlobs.expiresAt, now.getTime())).limit(80)
    if (!rows.length) return
    const keys = rows.map(row => row.key)
    const [error] = await blob.del(keys)
    if (error) throw error
    await releaseQuotaBlobs(keys)
  }
}
