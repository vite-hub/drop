import { defineHandler } from "h3"
import { findThread } from "../../../utils/comments"
import { findDrop, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { acceptSuggestion } from "../../../utils/suggestions"

/** Accepts a suggestion on a Markdown doc as its next version (../../../utils/suggestions.ts). */
export default defineHandler(async (event) => {
  const thread = await findThread(await routeId(event))
  const drop = thread ? await findDrop(thread.meta.dropId) : null
  return toSummary(await acceptSuggestion(drop, thread, await identify(event), event))
})
