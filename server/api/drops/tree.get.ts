import { defineValidatedHandler } from "h3"
import { DropTreeQuerySchema } from "#shared/schemas"
import { listTree } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/** The sidebar's drops: your newest at the top, and `?open=<id>` wherever it sits, with how many you have (listTree). */
export default defineValidatedHandler({
  validate: { query: DropTreeQuerySchema },
  async handler(event) {
    return listTree(await requireIdentity(event), event, event.url.searchParams.get("open") || undefined)
  },
})
