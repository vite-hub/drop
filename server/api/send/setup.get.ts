import { defineHandler } from "h3"
import { sealWebhooksText } from "vite-hub/webhooks"
import type { SendSetup } from "#shared/types"
import { requireIdentity } from "../../utils/identity"

// The pill asks after Send fails before it paired an agent: the server seals each agent with VITEHUB_WEBHOOKS_KEY, so
// a trial seal tells a host that never set the key, or set a bad one, from a pairing that failed for another reason.
export default defineHandler(async (event): Promise<SendSetup> => {
  const who = await requireIdentity(event)
  const [error] = await sealWebhooksText("drop:send-setup", "check")
  const problem = !error ? null : error.code === "WEBHOOKS_KEY_INVALID" ? "invalid" : "unset"
  return { problem, admin: who.role === "admin" }
})
