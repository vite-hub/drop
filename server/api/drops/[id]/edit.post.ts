import { defineHandler, HTTPError } from "h3"
import { splitFrontmatter } from "#shared/frontmatter"
import { findDrop, liveEditable, readText } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { logDrop } from "../../../utils/logs"
import { ensureDraft } from "../../../utils/live-drafts"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!drop || !drop.blobKey || !liveEditable(drop, who))
    throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
  const { body } = splitFrontmatter(await readText(drop.blobKey))
  const documentId = await ensureDraft(drop, body)
  logDrop(event, drop, { change: "draft" })
  return { documentId }
})
