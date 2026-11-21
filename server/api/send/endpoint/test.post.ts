import { defineHandler, HTTPError } from "h3"
import { getMemberEndpoint, sendToMemberEndpoint } from "vite-hub/webhooks"
import { getWebhookDelivery } from "vite-hub/webhooks/runtime"
import { requireIdentity } from "../../../utils/identity"

const TEST_TEXT = "A test delivery from the Agents page in Drop. There is nothing to answer: say that it arrived."

export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const [error, endpoint] = await getMemberEndpoint(who.userId)
  if (error) throw error
  if (!endpoint || endpoint.disabledAt !== null) throw new HTTPError({ status: 404, message: "No agent is paired." })
  const started = Date.now()
  const [sendError, sent] = await sendToMemberEndpoint(
    who.userId,
    { event: "webhooks.test", text: TEST_TEXT },
    { event: "webhooks.test", key: `test:${crypto.randomUUID()}`, endpointId: endpoint.id },
  )
  const ms = Date.now() - started
  if (sendError) return { status: "failed" as const, reason: sendError.why }
  if (sent.status === "inbox") return { status: "delivered" as const, code: null, ms }
  const [, delivery] = await getWebhookDelivery(sent.id)
  if (sent.status !== "sent")
    return { status: "failed" as const, reason: delivery?.lastError ?? "The agent's receiver did not take it." }
  return { status: "delivered" as const, code: delivery?.lastStatus ?? null, ms }
})
