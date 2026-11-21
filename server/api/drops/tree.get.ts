import { defineValidatedHandler } from "h3"
import { DropTreeQuerySchema } from "#shared/schemas"
import { listTree } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineValidatedHandler({
  validate: { query: DropTreeQuerySchema },
  async handler(event) {
    return listTree(await requireIdentity(event), event, event.url.searchParams.get("open") || undefined)
  },
})
