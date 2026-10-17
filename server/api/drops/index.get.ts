import { defineHandler, HTTPError } from "h3"
import { findDropByRef, listDrops, listFolder, listFolders, listSharedWithMe, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/**
 * Your drops at the top; with `?trash` the ones in your Trash; with `?shared` other people's drops shared with you;
 * with `?folders` every folder you have. `?q=` searches your drops at any depth, and with `?folder=<id or link>` the
 * folder's drops, or with `q` everything below it.
 */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const query = event.url.searchParams
  const words = query.get("q")?.slice(0, 200) || undefined
  if (query.has("folder")) {
    const folder = await findDropByRef(query.get("folder")!, event)
    if (!folder || folder.kind !== "folder" || !permissions(folder, who).view) throw new HTTPError({ status: 404, statusText: "No folder with that id." })
    return listFolder(folder, event, { query: words })
  }
  if (query.has("folders")) return listFolders(who, event)
  return query.has("shared") ? listSharedWithMe(who, event) : listDrops(who, event, { trash: query.has("trash"), query: words })
})
