import { defineValidatedHandler } from "h3"
import { AppSchema } from "#shared/schemas"
import { dropPageUrl, publishApp } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

export default defineValidatedHandler({
  validate: { body: AppSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const app = await publishApp(who, await event.req.json(), event)
    return {
      id: app.id,
      version: app.version,
      page: dropPageUrl(event.url.origin, app),
      share: app.share,
      warnings: app.warnings,
    }
  },
})
