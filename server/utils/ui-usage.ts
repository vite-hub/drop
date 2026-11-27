import { sql } from "drizzle-orm"
import { useRuntimeConfig } from "nitro/runtime-config"
import { chunkParameters, db } from "vite-hub/database"
import { uiUsage } from "../databases/default/usage"

type UsageRow = typeof uiUsage.$inferInsert

export async function countUsage(counts: Omit<UsageRow, "day" | "release">[], now = new Date()) {
  const { version, commit } = useRuntimeConfig().release
  const day = now.toISOString().slice(0, 10)
  const release = commit ? `${version}+${commit.slice(0, 8)}` : version
  const merged = new Map<string, UsageRow>()
  for (const { kind, mode, control, via, count } of counts) {
    const key = [kind, mode, control, via].join("\0")
    const row = merged.get(key)
    if (row) row.count += count
    else merged.set(key, { day, release, kind, mode, control, via, count })
  }
  const [first, ...rest] = chunkParameters([...merged.values()], { per: uiUsage }).map((rows) =>
    db
      .insert(uiUsage)
      .values(rows)
      .onConflictDoUpdate({
        target: [uiUsage.day, uiUsage.release, uiUsage.kind, uiUsage.mode, uiUsage.control, uiUsage.via],
        set: { count: sql`${sql.identifier(uiUsage.count.name)} + excluded.${sql.identifier(uiUsage.count.name)}` },
      }),
  )
  if (first) await db.batch([first, ...rest])
}
