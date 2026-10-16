import { defineHandler, HTTPError } from "h3"
import { emptyTrash } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

/** Empty Trash: deletes every drop in your Trash for good. People only. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  if (who.actorKind !== "browser") throw new HTTPError({ status: 403, statusText: "Only people can empty the Trash." })
  return { deleted: await emptyTrash(who, event) }
})
