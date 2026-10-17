import { defineHandler } from "h3"
import { listDrops, listSharedWithMe } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/** Your drops; with `?trash` the ones in your Trash; with `?shared` other people's drops shared with you. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const query = event.url.searchParams
  return query.has("shared") ? listSharedWithMe(who, event) : listDrops(who, event, { trash: query.has("trash") })
})
