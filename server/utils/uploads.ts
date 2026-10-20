import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { useStorage } from "nitro/storage"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { isRole } from "#shared/roles"
import { ACTOR_KINDS } from "#shared/types"
import { account, user as users } from "../databases/config"
import { isGitHubMember, membersOnly } from "./github-membership"
import type { Identity } from "./identity"
import { PublishInput } from "./publish"
import { seal, unseal } from "./review"

/**
 * Upload URLs. An agent can't send a screenshot through an MCP call without writing its bytes out as base64 in the
 * call itself, so `publish` with a file and no base64 answers with a URL instead, and the agent uploads the file there
 * with curl. The URL carries a sealed ticket: who asked, the rest of their `publish` call, and when it runs out.
 * Uploading runs that call with the file's bytes, checks and all, so the ticket can't do more than the call could.
 */

const UPLOAD_MINUTES = 15
// A ticket carries a whole publish call (a note, a keep reason, a title), so it's longer than a review token.
const MAX_TICKET = 8192

// Lazy: publish.ts imports this file, so its schema isn't there yet when this module loads.
const UploadTicket = v.object({
  u: v.string(),
  k: v.picklist(ACTOR_KINDS),
  a: v.string(),
  i: v.lazy(() => PublishInput),
  j: v.string(),
  e: v.number(),
})
type UploadTicket = v.InferOutput<typeof UploadTicket>

export async function signUpload(event: H3Event, who: Identity, input: PublishInput, now = Date.now()) {
  const { base64: _, ...file } = input.file!
  const ticket: UploadTicket = {
    u: who.userId,
    k: who.actorKind,
    a: who.actorName,
    i: { ...input, file },
    j: crypto.randomUUID(),
    e: now + UPLOAD_MINUTES * 60_000,
  }
  const sealed = await seal(event, "upload", ticket)
  return { url: new URL(`/api/uploads/${sealed}`, event.url.origin).href, expiresAt: ticket.e }
}

/** The ticket's call and the person it acts for, when the ticket is ours, unexpired, and its person may still publish. */
export async function readUpload(event: H3Event, sealed: string, now = Date.now()) {
  const ticket = await unseal(event, "upload", UploadTicket, sealed, MAX_TICKET)
  if (!ticket || ticket.e <= now || !ticket.i.file) return null
  const [row] = await db.select().from(users).where(eq(users.id, ticket.u)).limit(1)
  if (!row || row.banned) return null
  // A members-only Drop only acts for current members, as for any other request.
  if (membersOnly()) {
    const [github] = await db
      .select({ token: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, row.id), eq(account.providerId, "github")))
      .limit(1)
    if (!(await isGitHubMember(github?.token))) return null
  }
  const role = row.role ?? ""
  const who: Identity = {
    userId: row.id,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
    role: isRole(role) ? role : "member",
    actorKind: ticket.k,
    actorName: ticket.a,
  }
  return { who, input: ticket.i, id: ticket.j, expiresAt: ticket.e }
}

/** Takes the ticket for one upload. False when it was already taken; a failed upload hands it back with `release`. */
export async function claimUpload(id: string, expiresAt: number, now = Date.now()) {
  const storage = useStorage("cache")
  const key = `uploads:${id}`
  if (await storage.getItem(key)) return false
  await storage.setItem(key, 1, { ttl: Math.max(60, Math.ceil((expiresAt - now) / 1000)) })
  return true
}

export const releaseUpload = (id: string) => useStorage("cache").removeItem(`uploads:${id}`)
