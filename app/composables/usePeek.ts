import type { DropPeek, DropPeeks, DropSummary } from "#shared/types"

/** At most this many ids per request, as the endpoint takes. */
const BATCH = 90

// Peeks by drop and version, so a new version asks again and the rest come from here. Shared across the page.
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
    const found = await $fetch<DropPeeks>("/api/drops/peeks", { query: { ids: batch.join(",") } }).catch(() => ({}))
    // A drop that sent nothing (someone else's, or gone) keeps its kind's placeholder instead of asking again.
    for (const id of batch) store.value[asked.get(id)!] = (found as DropPeeks)[id] ?? null
  }
}

/**
 * What a card on the Drops page previews (`GET /api/drops/peeks`): undefined until it's asked for, null when there's
 * nothing to show. Cards ask as they mount in the browser, and every card that mounts in the same frame shares one
 * request, so a page of cards is one round trip. The server renders the kind's placeholder.
 */
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
        requestAnimationFrame(() => void flush())
      },
      { immediate: true },
    )
  return computed(() => store.value[keyOf(drop())])
}
