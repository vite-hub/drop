import type { Viewer } from "#shared/types"

/**
 * `useFetch` that runs as the visitor. On the server, this Nuxt nightly's `useRequestFetch()` is plain
 * `$fetch` and drops the request's cookies, so pass the session cookie along and SSR renders the visitor's
 * own drops. Newer nightlies forward it; this goes away with the next Nuxt bump.
 */
export const useApi = createUseFetch(() => ({ headers: useRequestHeaders(["cookie"]) }))

/** The signed-in person, their role, and whether this Drop is personal or a team. Null when signed out. */
export function useMe() {
  return useApi<Viewer | null>("/api/me", { key: "me", default: () => null })
}

/**
 * Turns an API error into the sentence the server wrote for people. Validation errors (h3's validated
 * handlers) carry the schema's own message in `data.issues`, which beats a generic "Validation failed".
 */
export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const value = error as { data?: { code?: string; statusText?: string; message?: string; data?: { issues?: Array<{ message?: string }> } }; statusMessage?: string }
  if (value?.data?.code === "DROP_LIMIT_REACHED") return value.data.message ?? fallback
  return value?.data?.data?.issues?.[0]?.message ?? value?.data?.statusText ?? value?.statusMessage ?? value?.data?.message ?? fallback
}
