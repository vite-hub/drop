import * as v from "valibot"
import type { ClientErrorSchema, ClientEventSchema } from "#shared/schemas"

type ClientError = v.InferInput<typeof ClientErrorSchema>
type ClientEvent = v.InferInput<typeof ClientEventSchema>
export type ClientErrorFields = Partial<Pick<ClientError, "status" | "requestId" | "drop" | "title" | "source">>
type Page = { path: string; online: boolean; leaving: boolean }

const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(schema), undefined)
const Code = optional(v.pipe(v.string(), v.regex(/^[A-Za-z][\w.]{0,59}$/)))
const Failure = v.object({
  name: optional(v.string()),
  message: optional(v.string()),
  status: optional(v.pipe(v.number(), v.integer(), v.minValue(100))),
  code: Code,
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

export function createClientErrorReporter(
  send: (body: ClientError) => void,
  sendEvent: (body: ClientEvent) => void = () => {},
) {
  const sent = new Set<string>()
  return (action: string, error: unknown, fields: ClientErrorFields, page: Page) => {
    const parsed = parse(error)
    if (parsed.name === "AbortError" || parsed.cause?.name === "AbortError" || !page.online || page.leaving) return
    const { status } = parsed
    const step = STEPS[action]
    if (step) {
      const code = parsed.code ?? parsed.data?.code ?? parsed.data?.data?.code
      sendEvent({ event: step, ...(code ? { code } : {}), ...(status && status <= 599 ? { status } : {}) })
    }
    if (status && serverLogged(parsed, status)) return
    const failure =
      error instanceof Error ? error : { name: "Error", message: parsed.message ?? String(error), stack: undefined }
    const key = `${action}:${failure.message}`
    if (sent.has(key) || sent.size >= 10) return
    sent.add(key)
    const requestId =
      fields.requestId ??
      parsed.requestId ??
      parsed.response?.headers.get("cf-ray") ??
      parsed.response?.headers.get("x-request-id") ??
      undefined
    send({
      action: action.slice(0, 60),
      path: page.path.slice(0, 600),
      name: failure.name.slice(0, 120),
      message: failure.message.slice(0, 1000),
      stack: failure.stack?.slice(0, 4000),
      ...fields,
      ...(status ? { status } : {}),
      ...(requestId ? { requestId: requestId.slice(0, 100) } : {}),
      ...(fields.title ? { title: fields.title.slice(0, 200) } : {}),
      ...(fields.source ? { source: fields.source.slice(0, 300) } : {}),
    })
  }
}

let leaving = false
if (import.meta.client) {
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pagehide", () => (leaving = true))
  // doctor-disable-next-line vue/lifecycle/require-cleanup -- for the page's whole life, not a component's
  addEventListener("pageshow", () => (leaving = false))
}

const report = createClientErrorReporter(
  (body) => {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  },
  (body) => sendClientEvent(body),
)

export function reportClientError(action: string, error: unknown, fields: ClientErrorFields = {}) {
  if (import.meta.client)
    report(action, error, fields, {
      path: window.location.pathname,
      online: navigator.onLine,
      leaving,
    })
}

export const answerError = (message: string, status: number, code?: string) =>
  Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
