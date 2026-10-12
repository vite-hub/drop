import { like, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { db } from "vite-hub/database/drizzle"
import { blobCleanup, dropFiles, drops } from "../databases/config"
import type { DropRow } from "./drops"
import { bindQuotaSQL, deletionChainSQL } from "./quota-sql"

const atomic = db as unknown as Pick<DrizzleD1Database, "batch">

/** Remove the whole logical drop at the batch's snapshot, including a concurrent revision that already committed. */
export async function deleteRetainedDrop(row: DropRow, deleteKeys: (keys: string[]) => Promise<void>) {
  const chain = bindQuotaSQL(deletionChainSQL, [row.id, row.ownerId, row.ownerId, row.id, row.ownerId, row.ownerId])
  const token = crypto.randomUUID()
  // Queue every key before its metadata disappears. The recursive query has a fixed number of parameters.
  const keys = sql`(
    SELECT ${drops.blobKey} AS blob_key FROM ${drops} WHERE ${drops.id} IN (${chain}) AND ${drops.blobKey} IS NOT NULL
    UNION SELECT ${dropFiles.blobKey} AS blob_key FROM ${dropFiles} WHERE ${dropFiles.dropId} IN (${chain})
  ) AS quota_keys`
  const queue = db.insert(blobCleanup).select(qb => qb.select({
    id: sql<string>`${token} || ':' || quota_keys.blob_key`.as("id"),
    blobKey: sql<string>`quota_keys.blob_key`.as("blob_key"),
    createdAt: sql<number>`${Date.now()}`.as("created_at"),
  }).from(keys).where(sql`1`)).onConflictDoNothing()
  const remove = db.delete(drops).where(sql`${drops.id} IN (${chain})`)
  const pending = db.select({ key: blobCleanup.blobKey }).from(blobCleanup).where(like(blobCleanup.id, `${token}:%`))
  const [, , rows] = await atomic.batch([queue, remove, pending])
  // Cleanup's retry INSERT binds three values per key, below D1's 100-value ceiling.
  for (let offset = 0; offset < rows.length; offset += 25)
    await deleteKeys(rows.slice(offset, offset + 25).map(item => item.key))
}
