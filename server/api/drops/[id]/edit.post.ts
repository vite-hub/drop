import { defineHandler, HTTPError } from "h3"
import { splitFrontmatter } from "#shared/frontmatter"
import { findDrop, liveEditable, permissions, readText, versionsOf } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { ensureDraft } from "#live-drafts"
import { routeId } from "../../../utils/params"

/** Opens the live draft of a Markdown drop's current version, starting it from the published text. */
export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!drop || !who || !drop.blobKey || !liveEditable(drop, permissions(drop, who), await versionsOf(drop)))
    throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
  const { body } = splitFrontmatter(await readText(drop.blobKey))
  return { documentId: await ensureDraft(drop.id, body) }
})
