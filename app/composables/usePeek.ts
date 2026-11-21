import type { DropPeek, DropPeeks, DropSummary } from "#shared/types"

const BATCH = 90

const peeks = () => useState<Record<string, DropPeek | null>>("drop-peeks", () => ({}))
const keyOf = (drop: DropSummary) => `${drop.id}@${drop.updatedAt}`
let waiting = new Map<string, string>()
let flushing = false

async function flush() {
  flushing = false
  const asked = waiting
  waiting = new Map()
  const store = peeks()
  const ids = [...asked.keys()]
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    const batch = ids.slice(offset, offset + BATCH)
    const found = await $fetch<DropPeeks>("/api/drops/peeks", { query: { ids: batch.join(",") } }).catch(
      (error: unknown): DropPeeks => {
        reportClientError("peeks", error)
        return {}
      },
    )
    for (const id of batch) store.value[asked.get(id)!] = found[id] ?? null
  }
}

export function usePeek(drop: () => DropSummary) {
  const store = peeks()
  if (import.meta.client)
    watch(
      () => keyOf(drop()),
      (key) => {
        if (key in store.value || [...waiting.values()].includes(key)) return
        waiting.set(drop().id, key)
        if (flushing) return
        flushing = true
        void nextTick(flush)
      },
      { immediate: true },
    )
  return computed(() => store.value[keyOf(drop())])
}
