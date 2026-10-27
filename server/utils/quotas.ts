import { and, count, eq, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { log } from "evlog"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { blob } from "vite-hub/blob"
import { PUBLISH_BURST, requirePublishBurst } from "./publish-burst"
import {
  MAX_APP_BYTES,
  MAX_APP_FILES,
  planLimits,
  quotaFailure,
  quotaToolFailure,
  type Plan,
  type QuotaFailure,
  type Usage,
} from "#shared/quotas"
import { useServerEnv } from "#vitehub/env/server"
import { codeImages, dropFiles, drops, quotaReservations, user } from "../databases/config"
import { isPaying } from "./teams"
import { appFileChunks, bindQuotaSQL, QUOTA_RESERVATION_TTL_MS, reserveSQL, usageSQL } from "./quota-sql"

type Statement = BatchItem<"sqlite">

// What the batch's last statement, the reservation's own update, returns: the reservation when its guard held.
const Finished = v.array(v.object({ id: v.string() }))

/** `DROP_QUOTAS`, `DROP_DEFAULT_PLAN`, and the `DROP_PRO_*` limits, typed and validated by Server Env. */
export function quotaConfig() {
  const { enabled, plan, proDrops, proBytes, proWrites, freeKept } = useServerEnv().drop.quotas
  return { enabled, defaultPlan: plan, pro: { drops: proDrops, bytes: proBytes, writes: proWrites }, freeKept }
}

async function ownerUsage(ownerId: string, month: string) {
  const [row] = await db.all<{ drops: number; bytes: number; writes: number }>(
    bindQuotaSQL(usageSQL, [ownerId, month, Date.now() - QUOTA_RESERVATION_TTL_MS]),
  )
  return row ?? { drops: 0, bytes: 0, writes: 0 }
}

/** A member's plan: the tier an admin gave them in the Auth Console, else DROP_DEFAULT_PLAN. */
function planOf(stored: string | null | undefined): Plan {
  return stored === "free" || stored === "pro" ? stored : quotaConfig().defaultPlan
}

/** Drops kept forever at once: the owner's own at the top, not their team folders, nor drops in the Trash. */
async function keptCount(ownerId: string) {
  const [row] = await db
    .select({ kept: count() })
    .from(drops)
    .where(
      and(
        eq(drops.ownerId, ownerId),
        eq(drops.lifetime, "keep"),
        isNull(drops.parentId),
        eq(drops.teamFolder, false),
        isNull(drops.trashedAt),
      ),
    )
  return row?.kept ?? 0
}

/**
 * Someone's plan and what they've used of it. A team that pays puts each member on Pro (./teams.ts); an admin's Pro on
 * the Auth Console, or DROP_DEFAULT_PLAN, applies otherwise.
 */
export async function getUsage(ownerId: string): Promise<Usage> {
  const config = quotaConfig()
  const [owner] = await db.select({ plan: user.plan }).from(user).where(eq(user.id, ownerId)).limit(1)
  const paid = await isPaying(ownerId)
  const plan = paid && planOf(owner?.plan) === "free" ? "pro" : planOf(owner?.plan)
  const limits = planLimits(config.enabled ? plan : "unlimited", config.pro, config.freeKept)
  const month = new Date().toISOString().slice(0, 7)
  const used = await ownerUsage(ownerId, month)
  return {
    enabled: config.enabled,
    plan,
    month,
    drops: { used: used.drops, limit: limits.drops },
    bytes: { used: used.bytes, limit: limits.bytes },
    writes: { used: used.writes, limit: limits.writes },
    kept: { used: limits.kept === null ? 0 : await keptCount(ownerId), limit: limits.kept },
    app: { files: limits.appFiles, bytes: limits.appBytes },
    paid,
    selfHostUrl: "/docs/self-host",
  }
}

/**
 * Refuses keeping one more drop forever past the plan's limit. `already` says the drop is kept now, so keeping it
 * again (a new version, a renewal) never counts twice. Folders hand their lifetime down, so only drops at the top count.
 */
export async function requireKeepSlot(ownerId: string, life: { lifetime: string }, already: boolean, top: boolean) {
  if (life.lifetime !== "keep" || already || !top || !quotaConfig().enabled) return
  const usage = await getUsage(ownerId)
  if (usage.kept.limit !== null && usage.kept.used >= usage.kept.limit)
    throw new DropQuotaError(quotaFailure("kept", usage.kept.used, usage.kept.limit))
}

export class DropQuotaError extends HTTPError {
  readonly quotaBody: QuotaFailure
  constructor(body: QuotaFailure) {
    super({
      status: body.retryable ? 429 : 402,
      message: body.message,
      data: body,
      body: { ...body },
      headers: body.retryAfterSeconds ? { "Retry-After": String(body.retryAfterSeconds) } : undefined,
    })
    this.quotaBody = body
  }
}

/** MCP limits are ordinary tool results, so agents can act on them without a protocol retry. */
export async function quotaToolResult<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof DropQuotaError)) throw error
    return quotaToolFailure(error.quotaBody)
  }
}

interface Cost {
  drops: number
  bytes: number
  writes: number
  targetId?: string
  app?: { files: number; bytes: number }
}

/** Reserve before touching blobs. Transfer to the write ledger in the metadata batch, or release on failure. */
export async function withDropQuota<T>(
  ownerId: string,
  cost: Cost,
  event: H3Event | undefined,
  operation: (quota: {
    commit: (statements: Statement[], success?: SQL) => Promise<void>
    fileInserts: (rows: (typeof dropFiles.$inferInsert)[]) => Statement[]
  }) => Promise<T>,
): Promise<T> {
  const config = quotaConfig()
  const usage = config.enabled
    ? await getUsage(ownerId)
    : {
        month: new Date().toISOString().slice(0, 7),
        plan: "unlimited",
        drops: { limit: null },
        bytes: { limit: null },
        writes: { limit: null },
        app: { files: MAX_APP_FILES, bytes: MAX_APP_BYTES },
      }
  if (cost.app) {
    if (cost.app.files > usage.app.files)
      throw new DropQuotaError(quotaFailure("appFiles", cost.app.files, usage.app.files))
    if (cost.app.bytes > usage.app.bytes)
      throw new DropQuotaError(quotaFailure("appBytes", cost.app.bytes, usage.app.bytes))
  }
  if (event) {
    try {
      await requirePublishBurst(event, ownerId)
    } catch (error) {
      if (HTTPError.isError(error) && error.status === 429) {
        const retryAfter = Number(new Headers(error.headers).get("retry-after"))
        throw new DropQuotaError(
          quotaFailure("burstPublishes", PUBLISH_BURST, PUBLISH_BURST, retryAfter > 0 ? Math.ceil(retryAfter) : 60),
        )
      }
      throw error
    }
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  let reserved: { id: string }[]
  try {
    reserved = config.enabled
      ? await db.all<{ id: string }>(
          bindQuotaSQL(reserveSQL, [
            ownerId,
            usage.month,
            now - QUOTA_RESERVATION_TTL_MS,
            id,
            cost.drops,
            cost.bytes,
            cost.writes,
            cost.targetId ?? null,
            now,
            usage.drops.limit === null ? 0 : 1,
            cost.drops,
            usage.drops.limit ?? 0,
            usage.bytes.limit === null ? 0 : 1,
            cost.bytes,
            usage.bytes.limit ?? 0,
            usage.writes.limit === null ? 0 : 1,
            cost.writes,
            usage.writes.limit ?? 0,
          ]),
        )
      : await db
          .insert(quotaReservations)
          .values({
            id,
            ownerId,
            month: usage.month,
            drops: cost.drops,
            bytes: cost.bytes,
            writes: cost.writes,
            targetId: null,
            createdAt: now,
          })
          .returning({ id: quotaReservations.id })
  } catch (error) {
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
    throw new HTTPError({
      status: 409,
      message: "Usage changed while publishing. Check usage before publishing again.",
    })
  }

  let committed = false
  try {
    const result = await operation({
      fileInserts: (rows) => appFileChunks(rows).map((chunk) => db.insert(dropFiles).values(chunk)),
      commit: async (statements, success = sql`1`) => {
        // A failed guard violates the ledger CHECK and rolls back the entire D1 batch.
        const finish = db
          .update(quotaReservations)
          .set({
            committed: true,
            drops: 0,
            bytes: 0,
            writes: sql`CASE WHEN (${success}) THEN ${quotaReservations.writes} ELSE -1 END`,
          })
          .where(eq(quotaReservations.id, id))
          .returning({ id: quotaReservations.id })
        const batch: [Statement, ...Statement[]] = [finish]
        batch.unshift(...statements)
        let results
        try {
          results = await db.batch(batch)
        } catch (error) {
          if (/CHECK constraint failed.*writes/i.test(String(error)))
            throw new HTTPError({
              status: 409,
              message: "This drop changed while publishing. Read the latest version.",
              cause: error,
            })
          throw error
        }
        const finished = v.safeParse(Finished, results.at(-1))
        committed = finished.success && finished.output.some((row) => row.id === id)
        if (!committed)
          throw new HTTPError({ status: 409, message: "This drop changed while publishing. Read the latest version." })
      },
    })
    if (!committed) throw new Error("Publishing must commit its quota reservation with its metadata.")
    return result
  } finally {
    if (!committed) await db.delete(quotaReservations).where(eq(quotaReservations.id, id))
  }
}

/** Release crashed publishes without deleting the committed monthly write ledger. */
export async function cleanupQuotaReservations(now: Date) {
  const released = await db
    .delete(quotaReservations)
    .where(
      and(
        eq(quotaReservations.committed, false),
        lt(quotaReservations.createdAt, now.getTime() - QUOTA_RESERVATION_TTL_MS),
      ),
    )
    .returning()
  for (const reservation of released)
    log.warn({ action: "quota-reservation-release", reservation, ageMs: now.getTime() - reservation.createdAt })
}

/**
 * Deletes expired code images: the blob first, then the row, so a failed delete is retried next hour and the image
 * keeps counting toward storage until it's gone. 80 keys a batch stays under D1's bind limit.
 */
export async function cleanupCodeImages(now: Date) {
  for (;;) {
    const rows = await db
      .select({ key: codeImages.blobKey })
      .from(codeImages)
      .where(lte(codeImages.expiresAt, now.getTime()))
      .limit(80)
    if (!rows.length) return
    const keys = rows.map((row) => row.key)
    const [error] = await blob.del(keys)
    if (error) throw error
    await db.delete(codeImages).where(inArray(codeImages.blobKey, keys))
  }
}
