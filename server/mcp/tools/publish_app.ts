import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { dropPageUrl, MAX_FILE_BYTES, publishApp } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { quotaToolResult } from "../../utils/quotas"

export default defineMcpTool({
  name: "publish_app",
  title: "Publish an app",
  description: "Publish a static app as files keyed by path (index.html required). Pass id to publish the next version of an existing app.",
  inputSchema: toStandardJsonSchema(v.object({
    files: v.pipe(v.record(v.string(), v.string()), v.description(`Path to file contents, e.g. {"index.html": "..."}. UTF-8 contents total at most ${MAX_FILE_BYTES} bytes.`)),
    name: v.optional(v.string()),
    id: v.optional(v.pipe(v.string(), v.description("Id of the app this publishes the next version of."))),
  })),
  handler: async (input, event) => quotaToolResult(async () => {
    const app = await publishApp(await requireIdentity(event), input, event)
    return `Published v${app.version}: ${dropPageUrl(event.url.origin, app.id)} (id=${app.id})`
  }),
})
