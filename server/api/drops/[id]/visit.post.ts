import { defineHandler, noContent } from "h3"
import { findDrop, permissions } from "../../../utils/drops"
import { recordVisit } from "../../../utils/expiry"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { countView } from "../../../utils/views"

export default defineHandler(async (event) => {
  const drop = await findDrop(await routeId(event), event)
  const who = await identify(event)
  if (drop && permissions(drop, who).view)
    await Promise.all([recordVisit(event, drop, who, "beacon"), countView(event, drop, who, "beacon")])
  return noContent()
})
