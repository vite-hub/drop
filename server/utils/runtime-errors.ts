import { useStorage } from "nitro/storage"

interface RuntimeError {
  kind: "error" | "rejection" | "console" | "load"
  message: string
  source?: string
  page?: string
  count: number
  lastAt: number
}

interface Entry {
  version: number
  errors: RuntimeError[]
}

const PREFIX = "runtime-errors:"
const MAX_ERRORS = 20
const TTL = 60 * 60 * 24 * 14

export async function recordRuntimeErrors(
  dropId: string,
  version: number,
  reports: Omit<RuntimeError, "count" | "lastAt">[],
) {
  const storage = useStorage("cache")
  const entry = await storage.getItem<Entry>(PREFIX + dropId)
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
  await storage.setItem(PREFIX + dropId, { version, errors: errors.slice(0, MAX_ERRORS) }, { ttl: TTL })
}

export async function runtimeErrors(dropId: string, version: number): Promise<RuntimeError[]> {
  const entry = await useStorage("cache").getItem<Entry>(PREFIX + dropId)
  return entry?.version === version ? entry.errors : []
}
