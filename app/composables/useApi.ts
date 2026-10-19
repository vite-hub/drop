import { createFetch } from "ofetch"

/**
 * Internal API calls run as the visitor. This Nuxt nightly's request fetch drops the cookies and origin.
 * Preserve both: Better Auth uses HTTPS to choose the __Secure- session cookie. Nitro's serverFetch
 * keeps the request in-process, including on Workers where fetching our own hostname would loop.
 */
export const useApi = createUseFetch(() => {
  if (import.meta.client) return {}
  const origin = useRequestURL().origin
  return {
    headers: useRequestHeaders(["cookie"]),
    $fetch: createFetch({ fetch: async (request, options) => {
      const { serverFetch } = await import("nitro")
      return serverFetch(new URL(request instanceof Request ? request.url : request, origin).href, options)
    } }) as typeof $fetch,
  }
})

/** The signed-in person, their role, and whether this Drop is personal or a team. Null when signed out. */
export function useMe() {
  return useApi("/api/me", { key: keys.me, default: () => null })
}

/** How this Drop signs people in. `proxy`: through an oauth2-proxy (read at runtime), so signing in again returns the same account. */
export function useSignInMethod() {
  return useApi("/api/sign-in", { key: keys.signIn })
}

/**
 * Turns an API error into the sentence the server wrote for people. Validation errors (h3's validated
 * handlers) carry the schema's own message in `data.issues`, which beats a generic "Validation failed".
 */
export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const value = error as { data?: { code?: string; statusText?: string; message?: string; data?: { issues?: Array<{ message?: string }> } }; statusText?: string; message?: string }
  if (value?.data?.code === "DROP_LIMIT_REACHED") return value.data.message ?? fallback
  return value?.data?.data?.issues?.[0]?.message ?? value?.data?.statusText ?? value?.statusText ?? value?.data?.message ?? value?.message ?? fallback
}
