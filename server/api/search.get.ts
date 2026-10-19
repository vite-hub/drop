import { defineValidatedHandler } from "h3"
import { SearchQuerySchema } from "#shared/schemas"
import { searchEverything } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

/** `?q=` across everything you can open: your drops at any depth, then other people's shared with you. Names and text. */
export default defineValidatedHandler({
  validate: { query: SearchQuerySchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const query = event.url.searchParams.get("q")?.slice(0, 200) ?? ""
    return searchEverything(who, query, event)
  },
})
