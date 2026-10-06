import { defineHandler, readValidatedBody } from "h3"
import * as v from "valibot"
import { dropPageUrl, publishApp } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

const Body = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.maxLength(160))),
  files: v.record(v.string(), v.string()),
})

/** Agents publish a static app: files keyed by path, with an index.html. Pass `id` to publish the next version. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const app = await publishApp(who, await readValidatedBody(event, Body))
  return { id: app.id, version: app.version, page: dropPageUrl(event.url.origin, app.id), visibility: app.visibility }
})
