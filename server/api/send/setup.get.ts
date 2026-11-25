import { defineHandler } from "h3"
import { sealWebhooksText } from "vite-hub/webhooks"
import type { SendSetup } from "#shared/types"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async (event): Promise<SendSetup> => {
  const who = await requireIdentity(event)
  const [error] = await sealWebhooksText("drop:send-setup", "check")
  const problem = !error ? null : error.code === "WEBHOOKS_KEY_INVALID" ? "invalid" : "unset"
  return { problem, admin: who.role === "admin" }
})
