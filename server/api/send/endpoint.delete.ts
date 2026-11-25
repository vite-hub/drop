import { defineHandler } from "h3"
import { removeMemberEndpoints } from "vite-hub/webhooks"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const [error] = await removeMemberEndpoints(who.userId)
  if (error) throw error
  return null
})
