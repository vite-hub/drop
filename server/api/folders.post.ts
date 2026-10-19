import { defineValidatedHandler } from "h3"
import { FolderSchema } from "#shared/schemas"
import { toSummary } from "../utils/drops"
import { createFolder, requireFolder } from "../utils/folders"
import { requireIdentity } from "../utils/identity"

/**
 * New folder, at the top or inside `folder`, with a description of what goes in it. It starts with this Drop's default
 * share, like any drop. `team` makes it one of the team's folders, which only admins do.
 */
export default defineValidatedHandler({
  validate: { body: FolderSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const body = await event.req.json()
    const parent = body.folder ? await requireFolder(body.folder, who, event, undefined, "folder") : undefined
    return toSummary(await createFolder(who, { title: body.title, folder: parent, note: body.description, team: body.team }, event))
  },
})
