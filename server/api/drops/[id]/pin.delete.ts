import { defineHandler, noContent } from "h3"
import { setPinned } from "../../../utils/drops"
import { requireIdentity } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  await setPinned(await routeId(event), who, false)
  return noContent()
})
