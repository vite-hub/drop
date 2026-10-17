import { defineHandler, HTTPError } from "h3"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { siteItems } from "../../../utils/review"

/** A site's review list for its page in Drop: every comment sent from the site, newest first, with its screenshot. */
export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (!drop || drop.kind !== "site" || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No site with that id." })
  event.res.headers.set("Cache-Control", "private, no-store")
  return await siteItems(drop, who, event.url.origin)
})
