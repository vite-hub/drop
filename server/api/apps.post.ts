import { defineValidatedHandler } from "h3"
import { AppSchema } from "#shared/schemas"
import { dropPageUrl, publishApp } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

/** Agents publish a static app: files keyed by path, with an index.html. Pass `id` to publish the next version. */
export default defineValidatedHandler({
  validate: { body: AppSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const app = await publishApp(who, await event.req.json())
    return { id: app.id, version: app.version, page: dropPageUrl(event.url.origin, app.id), visibility: app.visibility }
  },
})
