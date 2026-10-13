import { defineMcpTool } from "nitro-mcp-toolkit"
import { expiryLabel } from "#shared/expiry"
import { dropPageUrl, listDrops } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "list_drops",
  title: "List drops",
  description: "List your drops (docs and apps), newest first, with id, kind, visibility, expiry, and link.",
  annotations: { readOnlyHint: true },
  handler: async (event) => {
    const drops = await listDrops(await requireIdentity(event), event)
    const now = Date.now()
    return drops.map(drop => `- ${drop.title} (${drop.kind}, ${drop.visibility}, ${expiryLabel(drop, now).toLowerCase()}) id=${drop.id} ${dropPageUrl(event.url.origin, drop.id)}`).join("\n") || "No drops yet."
  },
})
