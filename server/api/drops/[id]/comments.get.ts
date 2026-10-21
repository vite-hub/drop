import { defineHandler, HTTPError } from "h3"
import { listComments } from "../../../utils/comments"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const id = await routeId(event)
  const [drop, who] = await Promise.all([findDrop(id, event), identify(event)])
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  return listComments(drop, who)
})
