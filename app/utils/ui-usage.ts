import type { DropKind } from "#shared/types"
import { MAX_USAGE_COUNTS, type UiControl, type UiMode, type UiVia } from "#shared/ui-usage"

export interface UsageCount {
  kind: DropKind
  mode: UiMode
  control: UiControl
  via: UiVia
  count: number
}

export function createUsageCounter({
  on,
  send,
}: {
  on: () => boolean
  send: (body: { event: "ui.usage"; counts: UsageCount[] }) => void
}) {
  const pending = new Map<string, UsageCount>()

  function flush() {
    if (!pending.size) return
    const counts = [...pending.values()]
    pending.clear()
    send({ event: "ui.usage", counts })
  }

  function add(entry: Omit<UsageCount, "count">) {
    if (!on()) return
    const key = `${entry.kind} ${entry.mode} ${entry.control} ${entry.via}`
    const counted = pending.get(key)
    if (counted) counted.count++
    else pending.set(key, { ...entry, count: 1 })
    if (pending.size >= MAX_USAGE_COUNTS) flush()
  }

  return {
    add,
    flush,
    get pending() {
      return pending.size
    },
  }
}
