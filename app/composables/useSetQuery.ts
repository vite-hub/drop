/**
 * Writes viewer state into the address's query, so the address bar can be shared as it is. Replaces the history entry
 * unless `push`, which gives the browser's Back a step to undo. `undefined` drops a key.
 */
export function useSetQuery() {
  const route = useRoute()
  return (patch: Record<string, string | number | undefined>, { push = false } = {}) =>
    navigateTo({ query: { ...route.query, ...patch }, hash: route.hash }, { replace: !push })
}
