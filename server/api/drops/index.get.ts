import { defineValidatedHandler, HTTPError } from "h3"
import { DropsQuerySchema } from "#shared/schemas"
import {
  findDropByRef,
  listDrops,
  listFolder,
  listFolders,
  listPinned,
  listSharedWithMe,
  permissions,
} from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { searchKinds } from "../../utils/search"

export default defineValidatedHandler({
  validate: { query: DropsQuerySchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const query = event.url.searchParams
    const words = query.get("q")?.slice(0, 200) || undefined
    const kinds = searchKinds(query.get("kind"))
    if (query.has("folder")) {
      const folder = await findDropByRef(query.get("folder")!, event)
      if (!folder || folder.kind !== "folder" || !permissions(folder, who).view)
        throw new HTTPError({ status: 404, statusText: "No folder with that id." })
      const limit = query.has("limit") ? Number(query.get("limit")) : undefined
      return listFolder(folder, event, { query: words, kinds, who, limit })
    }
    if (query.has("folders")) return listFolders(who, event)
    if (query.has("pinned")) return listPinned(who, event)
    return query.has("shared")
      ? listSharedWithMe(who, event)
      : listDrops(who, event, query.has("trash") ? { trash: true } : { query: words, kinds })
  },
})
