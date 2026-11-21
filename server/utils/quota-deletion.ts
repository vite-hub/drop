import { eq, like, sql } from "drizzle-orm"
import { chunkParameters, db } from "vite-hub/database"
import { blobCleanup, commentCleanup, dropFiles, drops, dropVersions } from "../databases/default/index"
import type { DropRow } from "./drops"

export async function deleteRetainedDrop(
  row: DropRow,
  deleteKeys: (keys: string[]) => Promise<void>,
  comments: Pick<typeof commentCleanup.$inferInsert, "scope" | "shot">,
) {
  const token = crypto.randomUUID()
  const keys = sql`(
    SELECT ${drops.blobKey} AS blob_key FROM ${drops} WHERE ${drops.id} = ${row.id} AND ${drops.blobKey} IS NOT NULL
    UNION SELECT ${dropVersions.blobKey} AS blob_key FROM ${dropVersions} WHERE ${dropVersions.dropId} = ${row.id} AND ${dropVersions.blobKey} IS NOT NULL
    UNION SELECT ${dropFiles.blobKey} AS blob_key FROM ${dropFiles} WHERE ${dropFiles.dropId} = ${row.id}
  ) AS quota_keys`
  const queue = db
    .insert(blobCleanup)
    .select((qb) =>
      qb
        .select({
          id: sql<string>`${token} || ':' || quota_keys.blob_key`.as("id"),
          blobKey: sql<string>`quota_keys.blob_key`.as("blob_key"),
          createdAt: sql<number>`${Date.now()}`.as("created_at"),
        })
        .from(keys)
        .where(sql`1`),
    )
    .onConflictDoNothing()
  const remove = db.delete(drops).where(eq(drops.id, row.id))
  const queueComments = db
    .insert(commentCleanup)
    .values({ dropId: row.id, ...comments, createdAt: Date.now() })
    .onConflictDoNothing()
  const pending = db
    .select({ key: blobCleanup.blobKey })
    .from(blobCleanup)
    .where(like(blobCleanup.id, `${token}:%`))
  const [, , , rows] = await db.batch([queue, queueComments, remove, pending])
  for (const chunk of chunkParameters(rows, { per: 3 })) await deleteKeys(chunk.map((item) => item.key))
}
