import { defineValidatedHandler } from "h3"
import { SiteSchema } from "#shared/schemas"
import { toSummary } from "../utils/drops"
import { requireFolder } from "../utils/folders"
import { requireIdentity } from "../utils/identity"
import { createSiteDrop } from "../utils/review"

/** New site review from the app, at the top or inside `folder`: the same rules as an agent's `publish({ site })`. */
export default defineValidatedHandler({
  validate: { body: SiteSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const body = await event.req.json()
    const folder = body.folder ? await requireFolder(body.folder, who, event) : undefined
    return toSummary(await createSiteDrop(who, { url: body.url, title: body.title, folder }, event))
  },
})
