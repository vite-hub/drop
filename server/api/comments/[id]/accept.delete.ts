import { eq } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { comments } from "../../../databases/config"
import { findDrop, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { undoSuggestion } from "../../../utils/suggestions"

/** Takes an accepted suggestion back while its version is the latest (../../../utils/suggestions.ts). */
export default defineHandler(async (event) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, await routeId(event)))
    .limit(1)
  const drop = comment ? await findDrop(comment.dropId) : null
  return toSummary(await undoSuggestion(drop, comment ?? null, await identify(event), event))
})
