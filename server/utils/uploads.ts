import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import * as v from "valibot"
import { db, withIdempotency } from "vite-hub/database"
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

export function invalidUpload() {
  return new HTTPError({
    status: 403,
    statusText: "This upload URL has run out or isn't valid. Call publish again for a new one.",
  })
}

export async function publishUploadOnce<T>(
  id: string,
  expiresAt: number,
  publish: () => Promise<T>,
): Promise<{ value: T } | null> {
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) throw invalidUpload()
  const seconds = Math.ceil(remaining / 1000)
  let published: { value: T } | undefined
  const [error] = await withIdempotency(
    `uploads:${id}`,
    async () => {
      if (expiresAt <= Date.now()) throw invalidUpload()
      published = { value: await publish() }
      return true
    },
    { ttl: Math.max(60, seconds), timeout: seconds },
  )
  if (error && error.code !== "DATABASE_IDEMPOTENCY_IN_PROGRESS") throw error
  return published ?? null
}
