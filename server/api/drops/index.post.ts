import { requirePublishBurst } from "../../utils/publish-burst"
import { defineValidatedHandler } from "h3"
import { NewDocSchema } from "#shared/schemas"
import { createDocDrop, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

/** Create a doc from text: the browser's "New drop" and template uploads. */
export default defineValidatedHandler({
  validate: { body: NewDocSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    await requirePublishBurst(event, who.userId)
    const body = await event.req.json()
    const drop = await createDocDrop(who, { filename: body.filename, bytes: new TextEncoder().encode(body.content), title: body.title, supersedes: body.supersedes }, event)
    return toSummary(drop)
  },
})
