import { eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { dropRuntimeErrors, type DropRuntimeError } from "../databases/default/drops"

const MAX_ERRORS = 20

export async function recordRuntimeErrors(
  dropId: string,
  version: number,
  reports: Omit<DropRuntimeError, "count" | "lastAt">[],
) {
  const [entry] = await db.select().from(dropRuntimeErrors).where(eq(dropRuntimeErrors.dropId, dropId)).limit(1)
  if (entry && entry.version > version) return
  const errors = entry?.version === version ? entry.errors : []
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
  await db
    .insert(dropRuntimeErrors)
    .values({ dropId, ...row })
    .onConflictDoUpdate({ target: dropRuntimeErrors.dropId, set: row })
}

export async function runtimeErrors(dropId: string, version: number): Promise<DropRuntimeError[]> {
  const [entry] = await db.select().from(dropRuntimeErrors).where(eq(dropRuntimeErrors.dropId, dropId)).limit(1)
  return entry?.version === version ? entry.errors : []
}
