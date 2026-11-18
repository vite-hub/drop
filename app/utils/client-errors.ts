import * as v from "valibot"
import { type BrowserReportOptions, reportBrowserError } from "vite-hub/logs/client"

/** What a report can say besides the error: the answer's status and request id, the drop, the toast's title. */
export type ClientErrorFields = { status?: number; requestId?: string; drop?: string; title?: string; source?: string }
type Page = { online: boolean; leaving: boolean }

// What a failure may carry: ofetch's FetchError, Better Auth's error, an upload's (send-file.ts), a DOMException. Any
// field missing or of another shape reads as undefined.
const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(schema), undefined)
const Failure = v.object({
  name: optional(v.string()),
  message: optional(v.string()),
  status: optional(v.pipe(v.number(), v.integer(), v.minValue(100))),
  requestId: optional(v.string()),
  cause: optional(v.object({ name: optional(v.string()) })),
  // Drop's own error body: h3 writes `status`, Nuxt's error page `statusCode`.
  data: optional(v.object({ status: optional(v.number()), statusCode: optional(v.number()) })),
  response: optional(v.object({ headers: v.instance(Headers) })),
})
const parse = (error: unknown) => {
  const parsed = v.safeParse(Failure, error)
  return parsed.success ? parsed.output : {}
}

/** The HTTP status of the answer a failed request got: ofetch's, Better Auth's, or an upload's. None without an answer. */
export const httpStatus = (error: unknown) => parse(error).status

/** Refusals are expected; a 5xx is already logged only when Drop's error body identifies it. */
function serverLogged(failure: v.InferOutput<typeof Failure>, status: number) {
  return (
    (status >= 400 && status < 500) ||
    (status >= 500 && (failure.data?.status === status || failure.data?.statusCode === status))
  )
}

// ViteHub keeps 300 characters of a field's string.
const text = (value?: string) => value?.slice(0, 300)

/**
 * A reporter that hands `send` each failure worth knowing about. It skips what the server logged itself and what isn't
 * a failure: an aborted request, an offline browser, a page that's leaving (its requests fail as it goes). `send` is
 * ViteHub's `reportBrowserError`, which sends each action and message once, at most ten a page.
 */
export function createClientErrorReporter(
  send: (error: unknown, options: BrowserReportOptions) => void = reportBrowserError,
) {
  return (action: string, error: unknown, fields: ClientErrorFields, page: Page) => {
    const parsed = parse(error)
    if (parsed.name === "AbortError" || parsed.cause?.name === "AbortError" || !page.online || page.leaving) return
    const { status } = parsed
    if (status && serverLogged(parsed, status)) return
    // Cloudflare's `cf-ray` finds the same request in the server's logs.
    const requestId =
      fields.requestId ??
      parsed.requestId ??
      parsed.response?.headers.get("cf-ray") ??
      parsed.response?.headers.get("x-request-id") ??
      undefined
    // ViteHub takes flat values only.
    const flat = Object.fromEntries(
      Object.entries({
        status: status ?? fields.status,
        requestId: text(requestId),
        drop: text(fields.drop),
        title: text(fields.title),
        source: text(fields.source),
      }).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
    )
    // Something thrown that isn't an Error is reported by its message or text.
    send(error instanceof Error ? error : (parsed.message ?? String(error)), { action, fields: flat })
  }
}

// A page that's leaving aborts its requests, and some browsers reject them as network errors rather than aborts.
let leaving = false
if (import.meta.client) {
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pagehide", () => (leaving = true))
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pageshow", () => (leaving = false))
}

const report = createClientErrorReporter()

/**
 * Tell the server something failed in this browser, with what the request's answer said when there was one. It goes to
 * ViteHub's `/api/_vitehub/browser-errors` (`observability.browserErrors` in nuxt.config.ts), whose event carries it as
 * `browserError`. It never throws: reporting an error mustn't make another one. On the server it does nothing: the
 * server logs its own errors.
 */
export function reportClientError(action: string, error: unknown, fields: ClientErrorFields = {}) {
  if (import.meta.client) report(action, error, fields, { online: navigator.onLine, leaving })
}

/** An error with the message and status of an answer (Better Auth's), so a refusal isn't reported as a failure. */
export const answerError = (message: string, status: number) => Object.assign(new Error(message), { status })
