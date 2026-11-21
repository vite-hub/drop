import { defineValidatedHandler } from "h3"
import { SearchQuerySchema } from "#shared/schemas"
import { searchEverything } from "../utils/drops"
import { requireIdentity } from "../utils/identity"
import { searchKinds } from "../utils/search"

export default defineValidatedHandler({
  validate: { query: SearchQuerySchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const query = event.url.searchParams.get("q")?.slice(0, 200) ?? ""
    return searchEverything(who, query, event, { kinds: searchKinds(event.url.searchParams.get("kind")) })
  },
})
