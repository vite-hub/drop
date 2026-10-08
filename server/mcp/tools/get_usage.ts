import { defineMcpTool } from "nitro-mcp-toolkit"
import { requireIdentity } from "../../utils/identity"
import { getUsage } from "../../utils/quotas"

export default defineMcpTool({
  name: "get_usage",
  title: "Get plan usage",
  description: "Read your plan, logical drop count, retained storage, calendar-month file writes, app limits, and upgrade or self-host links. Edits to someone else's drop use their plan.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  handler: async (_input, event) => {
    const usage = await getUsage((await requireIdentity(event)).userId)
    return { content: [{ type: "text", text: JSON.stringify(usage) }], structuredContent: { ...usage } }
  },
})
