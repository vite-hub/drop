import { defineHandler, HTTPError } from "h3"
import { listComments, readerOf } from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const id = await routeId(event)
  const version = Number(event.url.searchParams.get("v")) || undefined
  const [drop, who] = await Promise.all([findDropAt(id, version, event), identify(event)])
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  const guest = who ? null : await guestOf(event, { mint: permissions(drop, null).comment })
  return listComments(drop, readerOf(who, guest))
})
