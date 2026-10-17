import { defineValidatedHandler } from "h3"
import { FolderSchema } from "#shared/schemas"
import { toSummary } from "../utils/drops"
import { createFolder, requireFolder } from "../utils/folders"
import { requireIdentity } from "../utils/identity"
import { quotaApiHandler } from "../utils/quotas"

/** New folder, at the top or inside `folder`. Private until shared, like any drop. */
export default quotaApiHandler(defineValidatedHandler({
  validate: { body: FolderSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const body = await event.req.json() as { title: string; folder?: string }
    const parent = body.folder ? await requireFolder(body.folder, who, event) : undefined
    return toSummary(await createFolder(who, { title: body.title, folder: parent }, event))
  },
}))
