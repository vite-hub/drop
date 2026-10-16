import { defineHandler } from "h3"
import { listDrops } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/** Your drops, or with `?trash` the ones in your Trash. */
export default defineHandler(async event => listDrops(await requireIdentity(event), event, { trash: event.url.searchParams.has("trash") }))
