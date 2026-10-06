import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "h3"
import * as v from "valibot"
import { createDocDrop, findDrop, MAX_FILE_BYTES, permissions, publishApp, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"

const Body = v.union([
  v.object({ content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES)) }),
  v.object({ files: v.record(v.string(), v.string()) }),
])

/** Publish the next version: new text for a doc, a new file set for an app. People with edit access only. */
export default defineHandler(async (event) => {
  const drop = await findDrop(getRouterParam(event, "id") ?? "")
  const who = await identify(event)
  if (!drop || !permissions(drop, who).edit) throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
  const editor = who ?? { userId: drop.ownerId, name: "Guest", email: "", image: null, role: "member" as const, actorKind: "browser" as const, actorName: "Guest" }
  const body = await readValidatedBody(event, Body)
  if ("files" in body) {
    if (drop.kind !== "app") throw new HTTPError({ status: 400, statusText: "Only apps take files." })
    return toSummary(await publishApp(editor, { id: drop.id, files: body.files }))
  }
  if (drop.kind === "app") throw new HTTPError({ status: 400, statusText: "Apps take files, not content." })
  const next = await createDocDrop(editor, { filename: drop.filename, bytes: new TextEncoder().encode(body.content), supersedes: drop.id })
  return toSummary(next)
})
