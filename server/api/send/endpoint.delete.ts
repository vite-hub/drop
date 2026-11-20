import { defineHandler } from "h3"
import { getMemberEndpoint, removeMemberEndpoint } from "vite-hub/webhooks"
import { requireIdentity } from "../../utils/identity"

/** Removes the caller's Send agent. Their next Send pairs one again. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const [error, endpoint] = await getMemberEndpoint(who.userId)
  if (error) throw error
  if (!endpoint) return null
  const [removeError] = await removeMemberEndpoint(who.userId, endpoint.id)
  if (removeError) throw removeError
  return null
})
