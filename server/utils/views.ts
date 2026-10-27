import { eq, lt, sql } from "drizzle-orm"
import { log } from "evlog"
import { getRequestIP, type H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { DAY_MS } from "#shared/expiry"
import type { ViewerKind } from "#shared/types"
import { dropViewers, dropViews } from "../databases/config"
import type { DropRow } from "./drops"
import { isHumanVisit } from "./expiry"
import type { Identity } from "./identity"
import { isAttachment } from "./nodes"

type Viewed = Pick<DropRow, "id" | "ownerId" | "parentId" | "ancestors">

const dayOf = (at: number) => Math.floor(at / DAY_MS)

/**
 * Counts a view in the drop's Details, once a day per viewer: signed-in people and agents by who they are, anonymous
 * visitors by a hash of their address and browser (`visitorId`). Anonymous visitors count when they pass
 * `isHumanVisit`; people opening a raw file must too, so images their browser loads don't count. The owner's own visits
 * don't count; their agents' reads do. Files a doc embeds count only as the doc.
 */
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
    // A new row counts the view (the drop_viewers_count trigger); a repeat visit the same day writes nothing.
    await db.insert(dropViewers).values({ dropId: row.id, day, id, viewer }).onConflictDoNothing()
  } catch (error) {
    log.error({ action: "drop-view", error: String(error) })
  }
}

/**
 * An anonymous visitor for one drop and one day, with no cookie: an HMAC of their address and browser, keyed with the
 * auth secret, the day, and the drop. The same person gets another id tomorrow and on another drop, and the cleanup
 * deletes the day's ids once it's over.
 */
async function visitorId(event: H3Event, dropId: string, day: number) {
  const headers = event.req.headers
  const address = headers.get("cf-connecting-ip") ?? getRequestIP(event, { xForwardedFor: true }) ?? ""
  // Optional: an environment without the auth secret (the tests' one) still tells visitors apart.
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

/** A drop's views since it was published, every version together, by who viewed it. */
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

/** Deletes who viewed what before today: only the day's own ids are needed to count each viewer once. */
export const forgetViewers = (at: Date) => db.delete(dropViewers).where(lt(dropViewers.day, dayOf(at.getTime())))
