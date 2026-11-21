import type { LocationQueryRaw, Router } from "vue-router"

const pending = new WeakMap<Router, { location: string; query: LocationQueryRaw; hash: string }>()

const queryKey = (query: LocationQueryRaw) =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("&")

export function useSetQuery() {
  const route = useRoute()
  const router = useRouter()
  return async (
    patch: Record<string, string | number | undefined>,
    { push = false, hash }: { push?: boolean; hash?: string } = {},
  ) => {
    const location = `${route.path}${route.hash}`
    const pendingQuery = pending.get(router)
    const base = pendingQuery?.location === location ? pendingQuery : { query: route.query, hash: route.hash }
    const query = { ...base.query, ...patch }
    const nextHash = hash ?? base.hash
    if (queryKey(query) === queryKey(base.query) && nextHash === base.hash) return
    const next = { location, query, hash: nextHash }
    pending.set(router, next)
    try {
      await navigateTo({ query, hash: nextHash }, { replace: !push })
    } finally {
      if (pending.get(router) === next) pending.delete(router)
    }
  }
}
