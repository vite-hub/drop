import { defineHandler } from "h3"
import { getMemberEndpoint } from "vite-hub/webhooks"
import { sendAgent } from "../../utils/send-endpoint"
import { lastSentAt } from "../../utils/handoffs"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const [error, endpoint] = await getMemberEndpoint(who.userId)
  if (error) throw error
  if (!endpoint || endpoint.disabledAt !== null) return null
  return { agent: sendAgent(endpoint), lastSentAt: await lastSentAt(who.userId) }
})
