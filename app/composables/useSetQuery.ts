import type { LocationQueryRaw, Router } from "vue-router"

// The query each router is still navigating to, scoped to the route that started it.
const pending = new WeakMap<Router, { location: string; query: LocationQueryRaw }>()

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
    const location = `${route.path}${route.hash}`
    const pendingQuery = pending.get(router)
    const base = pendingQuery?.location === location ? pendingQuery.query : route.query
    const query = { ...base, ...patch }
    if (queryKey(query) === queryKey(base)) return
    const next = { location, query }
    pending.set(router, next)
    try {
      await navigateTo({ query, hash: route.hash }, { replace: !push })
    } finally {
      if (pending.get(router) === next) pending.delete(router)
    }
  }
}
