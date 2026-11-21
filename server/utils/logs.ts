import { AsyncLocalStorage } from "node:async_hooks"
import { type AuditActor, type AuditTarget, createLogger, log, type RequestLogger } from "evlog"
import { useLogger } from "evlog/nitro/v3"
import type { H3Event } from "h3"
import type { DropRow } from "./drops/types"
import type { Identity } from "./identity"

declare module "h3" {
  interface H3EventContext {
    /** The drop the request's wide event names (logDrop), so later reads don't replace it. */
    loggedDrop?: string
    /** The request's wide event is already out (an error page renders after it): nothing more goes on it. */
    logClosed?: boolean
    /** A Stripe webhook's audit is set (teams.ts `logSubscription`): a second callback on it doesn't replace it. */
    billingAudited?: boolean
  }
}

/** The request's wide event (evlog). None outside a request: the hourly schedule, and calls made without the event. */
export function requestLog(event?: H3Event | null): RequestLogger | undefined {
  if (!event?.req.context?.log || event.context.logClosed) return
  return useLogger(event)
}

// The host, for events outside a request, which no Nitro hook sees (server/plugins/wide-events.ts sets it).
let host: string | undefined
export const setDeploymentHost = (name: string) => {
  host = name
}
const deployment = () => (host ? { deployment: { host } } : {})

/** An event of its own, outside a request: a schedule's run, or a failure with no request to put it on. */
export const background = {
  logger: (fields: Record<string, unknown>) => createLogger({ ...fields, ...deployment() }),
  warn: (fields: Record<string, unknown>) => log.warn({ ...fields, ...deployment() }),
  error: (fields: Record<string, unknown>) => log.error({ ...fields, ...deployment() }),
}

/**
 * A failure Drop handled, with its stack and cause: on the request's wide event, or as an event of its own outside a
 * request. The request still answers, so it doesn't fail; its event is kept at the error level.
 */
export function logError(event: H3Event | undefined, error: unknown, fields: Record<string, unknown>) {
  const failure = error instanceof Error ? error : new Error(String(error))
  const request = requestLog(event)
  if (request) return request.error(failure, fields)
  background.error({ ...fields, error: { name: failure.name, message: failure.message, stack: failure.stack } })
}

/**
 * Better Auth runs Drop's hooks (server/auth.ts) without the request. The auth routes run inside this, so those hooks
 * can still put what they decided on the request's wide event.
 */
export const authRequest = new AsyncLocalStorage<H3Event>()

/** Who made the request. A person in the browser is their id only; an agent keeps its client's name. */
export function logActor(event: H3Event, who: Pick<Identity, "userId" | "role" | "actorKind" | "actorName">) {
  requestLog(event)?.set({
    user: { id: who.userId, role: who.role },
    actor: who.actorKind === "agent" ? { kind: who.actorKind, name: who.actorName } : { kind: who.actorKind },
  })
}

/** Why a request's identity was refused, while it still answers as signed out. */
export type AuthDenial = "banned" | "not-member"

export function logDenied(event: H3Event | undefined, denied: AuthDenial) {
  requestLog(event)?.set({ auth: { denied } })
}

type LoggedDrop = Pick<DropRow, "id" | "kind" | "version">

/**
 * Names the drop a request is about on its wide event: the first one it reads, so the folders and ancestors read
 * after it don't replace it. A write names the drop it wrote, with what it did (`change`) and the fields it changed.
 */
export function logDrop(event: H3Event | undefined, drop: LoggedDrop, change?: { change: string; fields?: string[] }) {
  const request = requestLog(event)
  if (!request || (!change && event!.context.loggedDrop)) return
  event!.context.loggedDrop = drop.id
  request.set({ drop: { id: drop.id, kind: drop.kind, version: drop.version, ...change } })
}

/** Who an audit names: a person, their agent, someone signed out, or Drop itself (`system`) with what acted. */
export function auditActor(who: Pick<Identity, "userId" | "actorKind"> | null | "stripe"): AuditActor {
  if (who === "stripe") return { type: "system", id: "stripe" }
  if (!who) return { type: "user", id: "anonymous" }
  return { type: who.actorKind === "agent" ? "agent" : "user", id: who.userId }
}

/**
 * An admin's or an account's action, as evlog's audit field: who did what to which target. evlog keeps every event
 * with one whatever the sampling rates, so they never need the error level to stay.
 */
export function logAudit(
  event: H3Event | undefined,
  who: Parameters<typeof auditActor>[0],
  action: string,
  target: AuditTarget,
  outcome: "success" | "failure" | "denied" = "success",
) {
  requestLog(event)?.set({ audit: { action, actor: auditActor(who), target, outcome } })
}
