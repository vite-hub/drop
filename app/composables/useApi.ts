import { createFetch } from "ofetch"
import * as v from "valibot"
import { QuotaFailureSchema, type QuotaFailure } from "#shared/quotas"

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
    // SAFETY: the same ofetch instance Nuxt's $fetch is, only with Nitro's in-process fetch; Nuxt's type adds the route typing.
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

// Every field may be missing or have another shape: it then reads as undefined instead of failing the whole error.
const text = v.fallback(v.optional(v.string()), undefined)
const ApiError = v.object({
  message: text,
  statusText: text,
  data: v.fallback(v.optional(v.object({
    code: text,
    message: text,
    statusText: text,
    data: v.fallback(v.optional(v.object({ issues: v.fallback(v.optional(v.array(v.object({ message: text }))), undefined) })), undefined),
  })), undefined),
})

/**
 * Turns an API error into the sentence the server wrote for people. Validation errors (h3's validated
 * handlers) carry the schema's own message in `data.issues`, which beats a generic "Validation failed".
 */
export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const parsed = v.safeParse(ApiError, error)
  if (!parsed.success) return fallback
  const value = parsed.output
  if (value.data?.code === "DROP_LIMIT_REACHED") return value.data.message ?? fallback
  return value.data?.data?.issues?.[0]?.message ?? value.data?.statusText ?? value.statusText ?? value.data?.message ?? value.message ?? fallback
}

/** The `data` an API error's body carries (an HTTPError's `data`), when it matches `schema`. */
export function errorData<T extends v.GenericSchema>(error: unknown, schema: T): v.InferOutput<T> | undefined {
  const parsed = v.safeParse(v.object({ data: v.object({ data: schema }) }), error)
  return parsed.success ? parsed.output.data.data : undefined
}

/** The body of a write the plan's limits refused. */
export function quotaFailureOf(error: unknown): QuotaFailure | undefined {
  const parsed = v.safeParse(v.object({ data: QuotaFailureSchema }), error)
  return parsed.success ? parsed.output.data : undefined
}
