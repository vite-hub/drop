import { defineHandler, HTTPError } from "h3"
import { listComments, readerOf } from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { guestOf } from "../../../utils/guests"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** The comments a version of the drop shows: its own and the open ones from before it. `?v=<n>` names the version. */
export default defineHandler(async (event) => {
  const id = await routeId(event)
  const version = Number(event.url.searchParams.get("v")) || undefined
  const [drop, who] = await Promise.all([findDropAt(id, version, event), identify(event)])
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  // A guest who may comment gets their browser's id now, so the cookie is there before their first comment: a comment
  // whose answer was lost is still theirs when it's sent again.
  const guest = who ? null : await guestOf(event, { mint: permissions(drop, null).comment })
  return listComments(drop, readerOf(who, guest))
})
