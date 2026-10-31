import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { joinFrontmatter, splitFrontmatter } from "#shared/frontmatter"
import { applySuggestion } from "#shared/suggestion"
import { suggestionAcceptances } from "../databases/config"
import { type DropThread, setResolved } from "./comments"
import { createDocDrop, type DropRow, findDropAt, permissions, readText } from "./drops"
import type { Identity } from "./identity"

const acceptedNote = (thread: DropThread) => `Accepted suggestion #${thread.number}`

/** Who may accept or undo a suggestion: editors of its Markdown doc, from the page or an agent. */
function requireSuggestion(drop: DropRow | null, thread: DropThread | null, who: Identity | null) {
  if (
    !thread ||
    thread.meta.suggestion === null ||
    !thread.meta.quote ||
    !drop ||
    thread.meta.dropId !== drop.id ||
    !who ||
    drop.kind !== "markdown" ||
    !drop.blobKey ||
    !permissions(drop, who).edit
  )
    throw new HTTPError({ status: 404, statusText: "You can't accept this suggestion." })
  return { drop, thread, who, blobKey: drop.blobKey, quote: thread.meta.quote, suggestion: thread.meta.suggestion }
}

async function acceptanceOf(drop: DropRow, thread: DropThread) {
  const [receipt] = await db
    .select()
    .from(suggestionAcceptances)
    .where(and(eq(suggestionAcceptances.threadId, thread.id), eq(suggestionAcceptances.dropId, drop.id)))
    .limit(1)
  return receipt
}

/** Publishes a suggestion as the next version, then resolves its thread. Retries finish only the resolution. */
export async function acceptSuggestion(
  row: DropRow | null,
  found: DropThread | null,
  identity: Identity | null,
  event: H3Event,
) {
  const { drop, thread, who, blobKey, quote, suggestion } = requireSuggestion(row, found, identity)
  if (thread.status === "resolved")
    throw new HTTPError({ status: 409, statusText: "This suggestion is already resolved." })
  await requireRateLimit(event, "drop-version", { key: `${drop.id}:${who.userId}`, limit: 20, window: "1m" })
  const accepted = await acceptanceOf(drop, thread)
  // Publication and Comments are separate writes. The receipt survives outages, restarts, and later versions.
  if (accepted && accepted.undoneVersion === null) {
    await setResolved(thread, true, who)
    return drop
  }
  const { frontmatter, body } = splitFrontmatter(await readText(blobKey))
  const applied = applySuggestion(body, quote, suggestion, thread.meta.label)
  if ("error" in applied) throw new HTTPError({ status: 409, statusText: applied.error })
  const next = await createDocDrop(
    who,
    {
      filename: drop.filename,
      bytes: new TextEncoder().encode(joinFrontmatter(frontmatter, applied.body)),
      supersedes: drop.id,
      acceptedSuggestionId: thread.id,
      note: acceptedNote(thread),
    },
    event,
  )
  await setResolved(thread, true, who)
  return next
}

/** Publishes the text before an accepted suggestion, then reopens it. History keeps both versions. */
export async function undoSuggestion(
  row: DropRow | null,
  found: DropThread | null,
  identity: Identity | null,
  event: H3Event,
) {
  const { drop, thread, who } = requireSuggestion(row, found, identity)
  if (thread.status !== "resolved")
    throw new HTTPError({ status: 409, statusText: "This suggestion's version isn't the latest anymore." })
  const accepted = await acceptanceOf(drop, thread)
  // Reopening can fail after the reversal committed too. Never publish that reversal a second time.
  if (accepted?.undoneVersion != null) {
    await setResolved(thread, false, who)
    return drop
  }
  if (drop.note !== acceptedNote(thread) || drop.version < 2 || (accepted && accepted.version !== drop.version))
    throw new HTTPError({ status: 409, statusText: "This suggestion's version isn't the latest anymore." })
  await requireRateLimit(event, "drop-version", { key: `${drop.id}:${who.userId}`, limit: 20, window: "1m" })
  const before = await findDropAt(drop.id, drop.version - 1, event)
  if (!before?.blobKey) throw new HTTPError({ status: 409, statusText: "The version before it is gone." })
  const next = await createDocDrop(
    who,
    {
      filename: drop.filename,
      bytes: new TextEncoder().encode(await readText(before.blobKey)),
      supersedes: drop.id,
      undoneSuggestionId: thread.id,
      note: `Undid suggestion #${thread.number}`,
    },
    event,
  )
  await setResolved(thread, false, who)
  return next
}
