import type { LocationQueryRaw, Router } from "vue-router"

// The query each router is still navigating to. A key on the router, not module state, so server requests don't share it.
const pending = new WeakMap<Router, LocationQueryRaw>()

const queryKey = (query: LocationQueryRaw) =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("&")

/**
 * Writes viewer state into the address's query, so the address bar can be shared as it is. Replaces the history entry
 * unless `push`, which gives the browser's Back a step to undo. `undefined` drops a key. Each write builds on the one
 * still landing, so a thread opened and closed at once leaves no `?comment=`, and one that changes nothing is skipped.
 */
export function useSetQuery() {
  const route = useRoute()
  const router = useRouter()
  return async (patch: Record<string, string | number | undefined>, { push = false } = {}) => {
    const base = pending.get(router) ?? route.query
    const query = { ...base, ...patch }
    if (queryKey(query) === queryKey(base)) return
    pending.set(router, query)
    try {
      await navigateTo({ query, hash: route.hash }, { replace: !push })
    } finally {
      if (pending.get(router) === query) pending.delete(router)
    }
  }
}
