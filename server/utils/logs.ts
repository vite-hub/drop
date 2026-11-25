import { AsyncLocalStorage } from "node:async_hooks"
import { type AuditActor, type AuditTarget, createLogger, log, type RequestLogger } from "evlog"
import { useLogger } from "evlog/nitro/v3"
import type { H3Event } from "h3"
import type { DropRow } from "./drops/types"
import type { Identity } from "./identity"

declare module "h3" {
  interface H3EventContext {
    loggedDrop?: string
    logClosed?: boolean
    billingAudited?: boolean
  }
}

export function requestLog(event?: H3Event | null): RequestLogger | undefined {
  if (!event?.req.context?.log || event.context.logClosed) return
  return useLogger(event)
}

let host: string | undefined
export const setDeploymentHost = (name: string) => {
  host = name
}
const deployment = () => (host ? { deployment: { host } } : {})

export const background = {
  logger: (fields: Record<string, unknown>) => createLogger({ ...fields, ...deployment() }),
  info: (fields: Record<string, unknown>) => log.info({ ...fields, ...deployment() }),
  warn: (fields: Record<string, unknown>) => log.warn({ ...fields, ...deployment() }),
  error: (fields: Record<string, unknown>) => log.error({ ...fields, ...deployment() }),
}

export function logError(event: H3Event | undefined, error: unknown, fields: Record<string, unknown>) {
  const failure = error instanceof Error ? error : new Error(String(error))
  const request = requestLog(event)
  if (request) return request.error(failure, fields)
  background.error({ ...fields, error: { name: failure.name, message: failure.message, stack: failure.stack } })
}

export const authRequest = new AsyncLocalStorage<H3Event>()

export function logActor(event: H3Event, who: Pick<Identity, "userId" | "role" | "actorKind" | "actorName">) {
  requestLog(event)?.set({
    user: { id: who.userId, role: who.role },
    actor: who.actorKind === "agent" ? { kind: who.actorKind, name: who.actorName } : { kind: who.actorKind },
  })
}

export type AuthDenial = "banned" | "not-member"

export function logDenied(event: H3Event | undefined, denied: AuthDenial) {
  requestLog(event)?.set({ identity: { denied } })
}

type LoggedDrop = Pick<DropRow, "id" | "kind" | "version">

export function logDrop(event: H3Event | undefined, drop: LoggedDrop, change?: { change: string; fields?: string[] }) {
  const request = requestLog(event)
  if (!request || (!change && event!.context.loggedDrop)) return
  event!.context.loggedDrop = drop.id
  request.set({ drop: { id: drop.id, kind: drop.kind, version: drop.version, ...change } })
}

export function auditActor(who: Pick<Identity, "userId" | "actorKind"> | null | "stripe"): AuditActor {
  if (who === "stripe") return { type: "system", id: "stripe" }
  if (!who) return { type: "user", id: "anonymous" }
  return { type: who.actorKind === "agent" ? "agent" : "user", id: who.userId }
}

export function logAudit(
  event: H3Event | undefined,
  who: Parameters<typeof auditActor>[0],
  action: string,
  target: AuditTarget,
  outcome: "success" | "failure" | "denied" = "success",
) {
  requestLog(event)?.set({ audit: { action, actor: auditActor(who), target, outcome } })
}
