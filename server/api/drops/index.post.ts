import { defineValidatedHandler } from "h3"
import { NewDocSchema } from "#shared/schemas"
import { createDocDrop, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { quotaApiHandler } from "../../utils/quotas"

/** Create a doc from text: the browser's "New drop" and template uploads. */
export default quotaApiHandler(defineValidatedHandler({
  validate: { body: NewDocSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const body = await event.req.json()
    const drop = await createDocDrop(who, { filename: body.filename, bytes: new TextEncoder().encode(body.content), title: body.title, supersedes: body.supersedes }, event)
    return toSummary(drop)
  },
}))
