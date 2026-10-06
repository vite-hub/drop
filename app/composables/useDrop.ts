import type { DropSummary, Viewer } from "#shared/types"

/** Server-side fetches carry the visitor's session cookie, so SSR renders their drops. */
export const sessionHeaders = () => useRequestHeaders(["cookie"])

/** The signed-in person, their role, and whether this Drop is personal or a team. */
export function useMe() {
  return useFetch<Viewer | null>("/api/me", { key: "me", default: () => null, headers: sessionHeaders() })
}

/** Your drops, newest first. Shared by the sidebar tree and the Drops page. */
export function useDrops() {
  return useFetch<DropSummary[]>("/api/drops", { key: "drops", default: () => [], headers: sessionHeaders() })
}

export const refreshDrops = () => refreshNuxtData("drops")

/** Turns an API error into the sentence the server wrote for people. */
export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const value = error as { data?: { statusText?: string; message?: string }; statusMessage?: string; message?: string }
  return value?.data?.statusText ?? value?.statusMessage ?? value?.data?.message ?? fallback
}
