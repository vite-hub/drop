import { defineHandler, HTTPError } from "h3"
import { listComments, toComment } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event))
  const who = await identify(event)
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  return (await listComments(drop.id)).map(row => toComment(row, who))
})
