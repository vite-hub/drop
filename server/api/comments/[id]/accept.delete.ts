import { defineHandler } from "h3"
import { findThread } from "../../../utils/comments"
import { findDrop, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { undoSuggestion } from "../../../utils/suggestions"

/** Takes an accepted suggestion back while its version is the latest (../../../utils/suggestions.ts). */
export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId) : null
  return toSummary(await undoSuggestion(drop, thread, await identify(event), event))
})
