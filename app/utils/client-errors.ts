import * as v from "valibot"
import { type BrowserReportOptions, reportBrowserError } from "vite-hub/logs/client"
import type { ClientEventSchema } from "#shared/schemas"

type ClientEvent = v.InferInput<typeof ClientEventSchema>
export type ClientErrorFields = { status?: number; requestId?: string; drop?: string; title?: string; source?: string }
type Page = { online: boolean; leaving: boolean }

const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(schema), undefined)
const Code = optional(v.pipe(v.string(), v.regex(/^[A-Za-z][\w.]{0,59}$/)))
const Failure = v.object({
  name: optional(v.string()),
  message: optional(v.string()),
  status: optional(v.pipe(v.number(), v.integer(), v.minValue(100))),
  code: optional(v.string()),
  requestId: optional(v.string()),
  cause: optional(v.object({ name: optional(v.string()) })),
  data: optional(
    v.object({
      status: optional(v.number()),
      statusCode: optional(v.number()),
      code: Code,
      data: optional(v.object({ code: Code })),
    }),
  ),
  response: optional(v.object({ headers: v.instance(Headers) })),
})
const parse = (error: unknown) => {
  const parsed = v.safeParse(Failure, error)
  return parsed.success ? parsed.output : {}
}

export const httpStatus = (error: unknown) => parse(error).status

function serverLogged(failure: v.InferOutput<typeof Failure>, status: number) {
  return (
    (status >= 400 && status < 500) ||
    (status >= 500 && (failure.data?.status === status || failure.data?.statusCode === status))
  )
}

const STEPS: Record<string, "signin.failed" | "consent.failed"> = {
  signin: "signin.failed",
  "signin-switch": "signin.failed",
  "oauth-signin": "signin.failed",
  "oauth-consent": "consent.failed",
}

const text = (value?: string) => value?.slice(0, 300)

export function createClientErrorReporter(
  send: (error: unknown, options: BrowserReportOptions) => void = reportBrowserError,
  sendEvent: (body: ClientEvent) => void = () => {},
) {
  return (action: string, error: unknown, fields: ClientErrorFields, page: Page) => {
    const parsed = parse(error)
    if (parsed.name === "AbortError" || parsed.cause?.name === "AbortError" || !page.online || page.leaving) return
    const { status, code } = parsed
    const step = STEPS[action]
    if (step) {
      const stepCode = v.parse(Code, code) ?? parsed.data?.code ?? parsed.data?.data?.code
      sendEvent({
        event: step,
        ...(stepCode ? { code: stepCode } : {}),
        ...(status && status <= 599 ? { status } : {}),
      })
    }
    if (status && serverLogged(parsed, status)) return
    const requestId =
      fields.requestId ??
      parsed.requestId ??
      parsed.response?.headers.get("cf-ray") ??
      parsed.response?.headers.get("x-request-id") ??
      undefined
    const flat = Object.fromEntries(
      Object.entries({
        status: status ?? fields.status,
        code: text(code),
        requestId: text(requestId),
        drop: text(fields.drop),
        title: text(fields.title),
        source: text(fields.source),
      }).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
    )
    send(error instanceof Error ? error : (parsed.message ?? String(error)), { action, fields: flat })
  }
}

let leaving = false
if (import.meta.client) {
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pagehide", () => (leaving = true))
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pageshow", () => (leaving = false))
}

const report = createClientErrorReporter(reportBrowserError, (body) => sendClientEvent(body))

export function reportClientError(action: string, error: unknown, fields: ClientErrorFields = {}) {
  if (import.meta.client) report(action, error, fields, { online: navigator.onLine, leaving })
}

const Answer = v.object({ code: Code, error: Code })

export function answerCode(failure: unknown) {
  const parsed = v.safeParse(Answer, failure)
  return parsed.success ? (parsed.output.code ?? parsed.output.error) : undefined
}

export const answerError = (message: string, status: number, code?: string) =>
  Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
