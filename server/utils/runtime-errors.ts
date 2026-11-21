import { and, eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { dropRuntimeErrors, type DropRuntimeError } from "../databases/default/drops"

const MAX_ERRORS = 20

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
    const errors = entry?.version === version ? entry.errors.map((error) => ({ ...error })) : []
    const now = Date.now()
    for (const report of reports) {
      const same = errors.find(
        (error) =>
          error.kind === report.kind &&
          error.message === report.message &&
          error.source === report.source &&
          error.page === report.page,
      )
      if (same) {
        same.count++
        same.lastAt = now
      } else errors.push({ ...report, count: 1, lastAt: now })
    }
    errors.sort((a, b) => b.lastAt - a.lastAt)
    const row = { version, errors: errors.slice(0, MAX_ERRORS), updatedAt: now }
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
