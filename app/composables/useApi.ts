import { createFetch } from "ofetch"
import * as v from "valibot"
import { QuotaFailureSchema, type QuotaFailure } from "#shared/quotas"

// doctor-disable-next-line nuxt/fetch/keyed-composable-registration-required -- Nuxt registers createUseFetch exports from composables/ itself (the build passes useApi its key); Doctor's manifest stringifies those entries to "[object Object]"
export const useApi = createUseFetch((defaults) => {
  if (import.meta.client) return {}
  const origin = useRequestURL().origin
  const page = useRequestEvent()
  return {
    dedupe: defaults.dedupe ?? "defer",
    getCachedData:
      defaults.getCachedData ??
      ((key, nuxtApp, context) => (context.cause === "initial" ? nuxtApp.payload.data[key] : undefined)),
    headers: useRequestHeaders(["cookie"]),
    // SAFETY: the same ofetch instance Nuxt's $fetch is, only with Nitro's in-process fetch; Nuxt's type adds the route typing.
    $fetch: createFetch({
      fetch: async (request, options) => {
        const { serverFetch } = await import("nitro")
        return serverFetch(new URL(request instanceof Request ? request.url : request, origin).href, options, {
          dropPage: page,
        })
      },
    }) as typeof $fetch,
  }
})

export function useMe() {
  return useApi("/api/me", { key: keys.me, default: () => null, transform: (viewer) => viewer || null })
}

export function useSignInMethod() {
  return useApi("/api/sign-in", { key: keys.signIn })
}

const text = v.fallback(v.optional(v.string()), undefined)
const ApiError = v.object({
  message: text,
  statusText: text,
  data: v.fallback(
    v.optional(
      v.object({
        code: text,
        message: text,
        statusText: text,
        data: v.fallback(
          v.optional(v.object({ issues: v.fallback(v.optional(v.array(v.object({ message: text }))), undefined) })),
          undefined,
        ),
      }),
    ),
    undefined,
  ),
})

export function errorText(error: unknown, fallback = "Something went wrong. Try again.") {
  const parsed = v.safeParse(ApiError, error)
  if (!parsed.success) return fallback
  const value = parsed.output
  if (value.data?.code === "DROP_LIMIT_REACHED") return value.data.message ?? fallback
  return (
    value.data?.data?.issues?.[0]?.message ??
    value.data?.statusText ??
    value.statusText ??
    value.data?.message ??
    value.message ??
    fallback
  )
}

export function errorData<T extends v.GenericSchema>(error: unknown, schema: T): v.InferOutput<T> | undefined {
  const parsed = v.safeParse(v.object({ data: v.object({ data: schema }) }), error)
  return parsed.success ? parsed.output.data.data : undefined
}

export function quotaFailureOf(error: unknown): QuotaFailure | undefined {
  const parsed = v.safeParse(v.object({ data: QuotaFailureSchema }), error)
  return parsed.success ? parsed.output.data : undefined
}
