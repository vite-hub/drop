import type { DropSummary, Viewer } from "#shared/types"

/**
 * `useFetch` that runs as the visitor. On the server, Nuxt calls the API without the request's cookies
 * (in this Nuxt nightly, `useRequestFetch()` doesn't forward them either), so pass the session cookie along
 * and SSR renders the visitor's own drops.
 */
export const useApi = createUseFetch(() => ({ headers: useRequestHeaders(["cookie"]) }))

/** The signed-in person, their role, and whether this Drop is personal or a team. */
export function useMe() {
  return useApi<Viewer | null>("/api/me", { key: "me", default: () => null })
}

/** Your drops, newest first. Shared by the sidebar tree and the Drops page. */
export function useDrops() {
  return useApi<DropSummary[]>("/api/drops", { key: "drops", default: () => [] })
}

export const refreshDrops = () => refreshNuxtData("drops")

/** Turns an API error into the sentence the server wrote for people. */
export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const value = error as { data?: { statusText?: string; message?: string }; statusMessage?: string; message?: string }
  return value?.data?.statusText ?? value?.statusMessage ?? value?.data?.message ?? fallback
}
