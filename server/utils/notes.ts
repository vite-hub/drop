import { and, desc, eq, isNull } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { verifyMcpRequest } from "vite-hub/auth/mcp"
import { db } from "vite-hub/database"
import { siteAddress, siteMatches } from "#shared/review"
import type { ReviewTarget } from "#shared/review-host"
import { hex, sha256 } from "#shared/utils/bytes"
import { drops, oauthConsent } from "../databases/default/index"
import { siteCoversDrop } from "./content-origin"
import { type DropRow, findDrop, permissions } from "./drops"
import { expiryPolicy } from "./expiry"
import { createFolder } from "./folders"
import { authFor, type Identity, identityOf } from "./identity"
import { ancestorsOf, resolveNode } from "./nodes"
import { notesResource } from "./oauth-resources"
import { createSiteDrop, sitesFor } from "./review"

export const NOTES_TARGET = "notes"
const NOTES_NAME = "Browser notes"
const INDEXED_SITES = 500

const signedOut = () =>
  new HTTPError({
    status: 401,
    statusText: "Link the extension to Drop again.",
    headers: { "WWW-Authenticate": 'Bearer realm="drop"' },
  })

export async function notesCaller(event: H3Event): Promise<Identity> {
  event.res.headers.set("Cache-Control", "no-store")
  const [error, caller] = await verifyMcpRequest(event.req, {
    auth: authFor(event),
    resource: notesResource(event.url.origin),
  })
  if (error) throw signedOut()
  const [consent] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.clientId, caller.clientId), eq(oauthConsent.userId, caller.user.id)))
    .limit(1)
  const who = consent ? await identityOf(caller.user.id) : null
  if (!who) throw signedOut()
  return who
}

export function exactOrigin(event: H3Event, origin: string) {
  if (siteAddress(origin) !== origin || origin.includes("*"))
    throw new HTTPError({ status: 400, statusText: "Drop takes notes on https pages, or http on localhost." })
  if (siteCoversDrop(event, origin))
    throw new HTTPError({ status: 400, statusText: "Drop doesn't take notes on its own pages." })
  return origin
}

const liveFolder = (who: Identity) =>
  db
    .select({ id: drops.id })
    .from(drops)
    .where(and(eq(drops.ownerId, who.userId), eq(drops.role, "notes-folder"), isNull(drops.trashedAt)))
    .limit(1)

async function notesIn(folderId: string, origin: string) {
  const [row] = await db
    .select({ id: drops.id })
    .from(drops)
    .where(
      and(eq(drops.parentId, folderId), eq(drops.role, "notes"), eq(drops.siteUrl, origin), isNull(drops.trashedAt)),
    )
    .limit(1)
  return row?.id ?? null
}

export async function findNotes(who: Identity, origin: string, event?: H3Event) {
  const [folder] = await liveFolder(who)
  const id = folder ? await notesIn(folder.id, origin) : null
  return id ? findDrop(id, event) : null
}

async function ensureFolder(who: Identity, event: H3Event) {
  const [found] = await liveFolder(who)
  if (found) return findDrop(found.id, event)
  return createFolder(who, { title: NOTES_NAME, slug: "browser-notes", role: "notes-folder" }, event).catch(
    async (error: unknown) => {
      const [raced] = await liveFolder(who)
      if (!raced) throw error
      return findDrop(raced.id, event)
    },
  )
}

export async function ensureNotes(who: Identity, origin: string, event: H3Event) {
  const existing = await findNotes(who, origin, event)
  if (existing) return existing
  const folder = await ensureFolder(who, event)
  if (!folder) throw new HTTPError({ status: 409, statusText: "Your notes folder changed. Try again." })
  return createSiteDrop(who, { url: origin, folder, role: "notes" }, event).catch(async (error: unknown) => {
    const raced = await notesIn(folder.id, origin)
    if (!raced) throw error
    return findDrop(raced, event)
  })
}

export async function notesTargets(who: Identity, origin: string, event: H3Event): Promise<ReviewTarget[]> {
  const reviews = await sitesFor(origin, who, event)
  return [
    ...reviews.map(({ site }) => ({ id: site.id, name: site.title, access: site.share })),
    { id: NOTES_TARGET, name: NOTES_NAME, access: "private" },
  ]
}

export async function targetSite(who: Identity, origin: string, target: string, event: H3Event) {
  const site = await findDrop(target, event)
  return site &&
    site.kind === "site" &&
    site.siteUrl &&
    siteMatches(site.siteUrl, origin) &&
    !(site.role === "notes" && site.ownerId !== who.userId) &&
    permissions(site, who).comment
    ? site
    : null
}

export async function notesIndex(who: Identity) {
  const [folder] = await liveFolder(who)
  const notes = folder
    ? await db
        .select({ siteUrl: drops.siteUrl })
        .from(drops)
        .where(and(eq(drops.parentId, folder.id), eq(drops.role, "notes"), isNull(drops.trashedAt)))
    : []
  const rows = await db
    .select()
    .from(drops)
    .where(and(eq(drops.kind, "site"), isNull(drops.role), isNull(drops.trashedAt), isNull(drops.quarantinedAt)))
    .orderBy(desc(drops.updatedAt))
    .limit(INDEXED_SITES)
  const ancestors = await ancestorsOf(rows)
  const { days } = expiryPolicy()
  const reviews = rows
    .map((row) => resolveNode(row, ancestors.get(row.id) ?? [], days))
    .filter((site: DropRow) => site.siteUrl && permissions(site, who).comment)
    .map((site) => site.siteUrl!)
  const origins = [...new Set([...reviews, ...notes.flatMap((row) => (row.siteUrl ? [row.siteUrl] : []))])].toSorted()
  const body = JSON.stringify({ origins })
  return { body, etag: `"${hex(await sha256(new TextEncoder().encode(body)))}"` }
}
