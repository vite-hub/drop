import { defineValidatedHandler, HTTPError } from "h3"
import { DropsQuerySchema } from "#shared/schemas"
import { findDropByRef, listDrops, listFolder, listFolders, listSharedWithMe, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/**
 * Your drops at the top; with `?trash` the ones in your Trash; with `?shared` what others share with you (on a team Drop
 * the team's folders first); with `?folders` every folder your drops may go in, yours and the team's. `?q=` searches your drops at any depth, by name and by a doc's text, and with
 * `?folder=<id or link>` the folder's drops, or with `q` everything below it.
 */
export default defineValidatedHandler({
  validate: { query: DropsQuerySchema },
  async handler(event) {
  const who = await requireIdentity(event)
  const query = event.url.searchParams
  const words = query.get("q")?.slice(0, 200) || undefined
  if (query.has("folder")) {
    const folder = await findDropByRef(query.get("folder")!, event)
    if (!folder || folder.kind !== "folder" || !permissions(folder, who).view) throw new HTTPError({ status: 404, statusText: "No folder with that id." })
    return listFolder(folder, event, { query: words, who })
  }
  if (query.has("folders")) return listFolders(who, event)
  return query.has("shared") ? listSharedWithMe(who, event) : listDrops(who, event, { trash: query.has("trash"), query: words })
  },
})
