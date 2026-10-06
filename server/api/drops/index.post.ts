import { defineHandler, readValidatedBody } from "h3"
import * as v from "valibot"
import { createDocDrop, MAX_FILE_BYTES, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

const Body = v.object({
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES)),
  title: v.optional(v.string()),
  supersedes: v.optional(v.string()),
})

/** Create a doc from text: the browser's "New drop" and template uploads. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const body = await readValidatedBody(event, Body)
  const drop = await createDocDrop(who, { filename: body.filename, bytes: new TextEncoder().encode(body.content), title: body.title, supersedes: body.supersedes })
  return toSummary(drop)
})
