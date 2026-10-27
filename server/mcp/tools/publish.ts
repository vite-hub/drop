import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import { requireIdentity } from "../../utils/identity"
import { publishInput, PublishInput } from "../../utils/publish"
import { quotaToolResult } from "../../utils/quotas"

export default defineMcpTool({
  name: "publish",
  title: "Publish a drop",
  description:
    "Publish one thing for review: a doc (markdown or html), a static app (files for a small one, archive for a built folder such as dist/), a file such as a screenshot (file), or a live website reviewed in place (site), or a whiteboard people draw on together (board). Before publishing something new, read list_folders and pass the folder whose description fits it; with none that fits, leave folder out. Pass previous to publish a doc's or app's next version. Pass agent with your known model, harness, and reasoningLevel for this publish; omit unknown values. Every call creates a drop or a version, so don't repeat a call that succeeded.",
  inputSchema: toStandardJsonSchema(PublishInput),
  handler: async (input, event) =>
    quotaToolResult(async () => {
      const { text, result } = await publishInput(await requireIdentity(event), input, event)
      return { content: [{ type: "text" as const, text }], structuredContent: result }
    }),
})
