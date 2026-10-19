import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import { requireIdentity } from "../../utils/identity"
import { publishInput, PublishInput } from "../../utils/publish"
import { quotaToolResult } from "../../utils/quotas"

export default defineMcpTool({
  name: "publish",
  title: "Publish a drop",
  description: "Publish one thing for review: a doc (markdown or html), a static app (files), a file such as a screenshot (file), or a live website reviewed in place (site). Pass previous to publish a doc's or app's next version, and folder to put it in a folder. Every call creates a drop or a version, so don't repeat a call that succeeded.",
  inputSchema: toStandardJsonSchema(PublishInput),
  handler: async (input, event) => quotaToolResult(async () => {
    const { text, result } = await publishInput(await requireIdentity(event), input, event)
    return { content: [{ type: "text" as const, text }], structuredContent: result }
  }),
})
