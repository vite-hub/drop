import { eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { useStorage } from "nitro/storage"
import * as v from "valibot"
import { db } from "vite-hub/database"
import { isRole } from "#shared/roles"
import { ACTOR_KINDS } from "#shared/types"
import { user as users } from "../databases/default/index"
import type { Identity } from "./identity"
import { isMember } from "./members"
import { PublishInput } from "./publish"
import { seal, unseal } from "./review"

const UPLOAD_MINUTES = 15
const MAX_TICKET = 12_288

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
  const ticket: UploadTicket = {
    u: who.userId,
    k: who.actorKind,
    a: who.actorName,
    i: input.file ? { ...input, file: { name: input.file.name } } : input,
    j: crypto.randomUUID(),
    e: now + UPLOAD_MINUTES * 60_000,
  }
  const sealed = await seal(event, "upload", ticket)
  return { url: new URL(`/api/uploads/${sealed}`, event.url.origin).href, expiresAt: ticket.e }
}

export async function readUpload(event: H3Event, sealed: string, now = Date.now()) {
  const ticket = await unseal(event, "upload", UploadTicket, sealed, MAX_TICKET)
  if (!ticket || ticket.e <= now || (!ticket.i.file && !ticket.i.archive)) return null
  const [row] = await db.select().from(users).where(eq(users.id, ticket.u)).limit(1)
  if (!row || row.banned) return null
  if (!(await isMember(row.id, event))) return null
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

export async function claimUpload(id: string, expiresAt: number, now = Date.now()) {
  const storage = useStorage("cache")
  const key = `uploads:${id}`
  if (await storage.getItem(key)) return false
  await storage.setItem(key, 1, { ttl: Math.max(60, Math.ceil((expiresAt - now) / 1000)) })
  return true
}

export const releaseUpload = (id: string) => useStorage("cache").removeItem(`uploads:${id}`)
