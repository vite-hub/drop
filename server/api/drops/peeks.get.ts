import { defineValidatedHandler } from "h3"
import { PeeksQuerySchema } from "#shared/schemas"
import { requireIdentity } from "../../utils/identity"
import { peeksOf } from "../../utils/drops/peeks"

export default defineValidatedHandler({
  validate: { query: PeeksQuerySchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const ids = event.url.searchParams.get("ids")?.split(",").filter(Boolean) ?? []
    event.res.headers.set("Cache-Control", "private, no-store")
    return peeksOf(who.userId, ids)
  },
})
