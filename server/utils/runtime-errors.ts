import { and, eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { addRuntimeErrors } from "#shared/runtime-errors"
import { dropRuntimeErrors, type DropRuntimeError } from "../databases/default/drops"

export async function recordRuntimeErrors(
  dropId: string,
  version: number,
  reports: Omit<DropRuntimeError, "count" | "lastAt">[],
) {
  const key = eq(dropRuntimeErrors.dropId, dropId)
  const returning = { dropId: dropRuntimeErrors.dropId }
  for (;;) {
    const [entry] = await db.select().from(dropRuntimeErrors).where(key).limit(1)
    if (entry && entry.version > version) return
    const now = Date.now()
    const errors = addRuntimeErrors(entry?.version === version ? entry.errors : [], reports, now)
    const row = { version, errors, updatedAt: now }
    const written = entry
      ? await db
          .update(dropRuntimeErrors)
          .set(row)
          .where(and(key, eq(dropRuntimeErrors.version, entry.version), eq(dropRuntimeErrors.errors, entry.errors)))
          .returning(returning)
      : await db
          .insert(dropRuntimeErrors)
          .values({ dropId, ...row })
          .onConflictDoNothing()
          .returning(returning)
    if (written.length) return
  }
}

export async function runtimeErrors(dropId: string, version: number): Promise<DropRuntimeError[]> {
  const [entry] = await db.select().from(dropRuntimeErrors).where(eq(dropRuntimeErrors.dropId, dropId)).limit(1)
  return entry?.version === version ? entry.errors : []
}
