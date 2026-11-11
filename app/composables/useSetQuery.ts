import type { LocationQueryRaw, Router } from "vue-router"

// The query each router is still navigating to. A key on the router, not module state, so server requests don't share it.
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
 * `hash` replaces the address's hash; without it the hash stays.
 */
export function useSetQuery() {
  const route = useRoute()
  const router = useRouter()
  return async (
    patch: Record<string, string | number | undefined>,
    { push = false, hash = route.hash }: { push?: boolean; hash?: string } = {},
  ) => {
    const location = `${route.path}${route.hash}`
    const pendingQuery = pending.get(router)
    const base = pendingQuery?.location === location ? pendingQuery.query : route.query
    const query = { ...base, ...patch }
    if (queryKey(query) === queryKey(base) && hash === route.hash) return
    const next = { location, query }
    pending.set(router, next)
    try {
      await navigateTo({ query, hash }, { replace: !push })
    } finally {
      if (pending.get(router) === next) pending.delete(router)
    }
  }
}
