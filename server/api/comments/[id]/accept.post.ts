import { and, eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { joinFrontmatter, splitFrontmatter } from "#shared/frontmatter"
import { applySuggestion } from "#shared/suggestion"
import { suggestionAcceptances } from "../../../databases/config"
import { findThread, setResolved } from "../../../utils/comments"
import { createDocDrop, findDrop, permissions, readText, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/**
 * Accepts a suggestion on a Markdown doc: its words go into the latest version's text, published as the next version,
 * and the comment is resolved. People who can edit the doc only; agents make the change and publish themselves.
 */
export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId) : null
  const who = await identify(event)
  if (
    !thread ||
    thread.meta.suggestion === null ||
    !thread.meta.quote ||
    !drop ||
    !who ||
    who.actorKind !== "browser" ||
    drop.kind !== "markdown" ||
    !drop.blobKey ||
    !permissions(drop, who).edit
  )
    throw new HTTPError({ status: 404, statusText: "You can't accept this suggestion." })
  if (thread.status === "resolved")
    throw new HTTPError({ status: 409, statusText: "This suggestion is already resolved." })
  await requireRateLimit(event, "drop-version", { key: `${drop.id}:${who.userId}`, limit: 20, window: "1m" })
  const [accepted] = await db
    .select({ version: suggestionAcceptances.version })
    .from(suggestionAcceptances)
    .where(and(eq(suggestionAcceptances.threadId, thread.id), eq(suggestionAcceptances.dropId, drop.id)))
    .limit(1)
  // Publishing and Comments are separate writes. A receipt survives either a resolution failure or a restart,
  // even if someone publishes another version before retrying acceptance.
  if (accepted) {
    await setResolved(thread, true, who)
    return toSummary(drop)
  }
  const source = await readText(drop.blobKey)
  const { frontmatter, body } = splitFrontmatter(source)
  const applied = applySuggestion(body, thread.meta.quote, thread.meta.suggestion, thread.meta.label)
  if ("error" in applied) throw new HTTPError({ status: 409, statusText: applied.error })
  const next = await createDocDrop(
    who,
    {
      filename: drop.filename,
      bytes: new TextEncoder().encode(joinFrontmatter(frontmatter, applied.body)),
      supersedes: drop.id,
      acceptedSuggestionId: thread.id,
      note: `Accepted suggestion #${thread.number}`,
    },
    event,
  )
  await setResolved(thread, true, who)
  return toSummary(next)
})
