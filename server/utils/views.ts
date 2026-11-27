import { eq, lt, sql } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database"
import { useServerEnv } from "vite-hub/env"
import { DAY_MS } from "#shared/expiry"
import type { ViewerKind } from "#shared/types"
import { dropViewers, dropViews } from "../databases/default/index"
import { viewerAddress } from "./client-address"
import type { DropRow } from "./drops"
import { isHumanVisit } from "./expiry"
import type { Identity } from "./identity"
import { logError } from "./logs"
import { isAttachment } from "./nodes"

type Viewed = Pick<DropRow, "id" | "ownerId" | "parentId" | "ancestors">

const dayOf = (at: number) => Math.floor(at / DAY_MS)

export async function countView(event: H3Event, row: Viewed, who: Identity | null, kind: "beacon" | "document") {
  if (isAttachment(row) || (who?.actorKind === "browser" && who.userId === row.ownerId)) return
  if (!(who && kind === "beacon") && !isHumanVisit(event.req.headers, kind)) return
  const day = dayOf(Date.now())
  const viewer: ViewerKind = !who ? "anonymous" : who.actorKind === "agent" ? "agent" : "person"
  const id = !who
    ? await visitorId(event, row.id, day)
    : who.actorKind === "agent"
      ? `agent:${who.userId}:${who.actorName}`
      : `user:${who.userId}`
  try {
    await db.insert(dropViewers).values({ dropId: row.id, day, id, viewer }).onConflictDoNothing()
  } catch (error) {
    logError(event, error, { action: "drop-view" })
  }
}

async function visitorId(event: H3Event, dropId: string, day: number) {
  const headers = event.req.headers
  const address = viewerAddress(event) ?? ""
  const secret = useServerEnv(event).auth?.secret?.unseal() || "drop-views"
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`drop-views:${secret}:${day}:${dropId}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const message = new TextEncoder().encode(`${address}\n${headers.get("user-agent") ?? ""}`)
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, message))
  return `anon:${Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export async function viewsOf(row: Pick<DropRow, "id">): Promise<Record<ViewerKind, number>> {
  const views: Record<ViewerKind, number> = { person: 0, anonymous: 0, agent: 0 }
  for (const count of await db
    .select({ viewer: dropViews.viewer, views: sql`sum(${dropViews.views})`.mapWith(Number) })
    .from(dropViews)
    .where(eq(dropViews.dropId, row.id))
    .groupBy(dropViews.viewer))
    views[count.viewer] = count.views
  return views
}

export const forgetViewers = (at: Date) => db.delete(dropViewers).where(lt(dropViewers.day, dayOf(at.getTime())))
