import { eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { joinFrontmatter, splitFrontmatter } from "#shared/frontmatter"
import { applySuggestion } from "#shared/suggestion"
import { comments } from "../databases/config"
import type { CommentRow } from "./comments"
import { createDocDrop, type DropRow, findDropAt, permissions, readText } from "./drops"
import type { Identity } from "./identity"

const acceptedNote = (comment: Pick<CommentRow, "n">) => `Accepted suggestion #${comment.n}`

/** Who may accept or undo `comment` on `drop`: editors of a Markdown doc, on a comment that suggests words. */
function requireSuggestion(drop: DropRow | null, comment: CommentRow | null, who: Identity | null) {
  if (
    !comment ||
    comment.suggestion === null ||
    !comment.quote ||
    !drop ||
    !who ||
    drop.kind !== "markdown" ||
    !drop.blobKey ||
    !permissions(drop, who).edit
  )
    throw new HTTPError({ status: 404, statusText: "You can't accept this suggestion." })
  return { drop, comment, who, blobKey: drop.blobKey, quote: comment.quote, suggestion: comment.suggestion }
}

/**
 * Puts a suggestion's words into the doc's latest text, publishes that as the next version, and resolves the comment.
 * Resolves to the new version.
 */
export async function acceptSuggestion(
  row: DropRow | null,
  found: CommentRow | null,
  identity: Identity | null,
  event: H3Event,
) {
  const { drop, comment, who, blobKey, quote, suggestion } = requireSuggestion(row, found, identity)
  if (comment.resolved) throw new HTTPError({ status: 409, statusText: "This suggestion is already resolved." })
  await requireRateLimit(event, "drop-version", { key: `${drop.id}:${who.userId}`, limit: 20, window: "1m" })
  const { frontmatter, body } = splitFrontmatter(await readText(blobKey))
  const applied = applySuggestion(body, quote, suggestion, comment.label)
  if ("error" in applied) throw new HTTPError({ status: 409, statusText: applied.error })
  const next = await createDocDrop(
    who,
    {
      filename: drop.filename,
      bytes: new TextEncoder().encode(joinFrontmatter(frontmatter, applied.body)),
      supersedes: drop.id,
      note: acceptedNote(comment),
    },
    event,
  )
  await db.update(comments).set({ resolved: true }).where(eq(comments.id, comment.id))
  return next
}

/**
 * Takes an accepted suggestion back while its version is still the latest: the text before it is published again as
 * the next version, and the comment opens again. History keeps both.
 */
export async function undoSuggestion(
  row: DropRow | null,
  found: CommentRow | null,
  identity: Identity | null,
  event: H3Event,
) {
  const { drop, comment, who } = requireSuggestion(row, found, identity)
  if (!comment.resolved || drop.note !== acceptedNote(comment) || drop.version < 2)
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
      note: `Undid suggestion #${comment.n}`,
    },
    event,
  )
  await db.update(comments).set({ resolved: false }).where(eq(comments.id, comment.id))
  return next
}
